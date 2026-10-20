import {runScheduledMonitor, dryRunStatus} from "./monitor.js";
// Cloudflare-only Ticket Plus official sale-state reader; no login or purchases.
const EVENT = "af2bd66d8fe65d78963cbb5bdc85771c";
const BASE = "https://apis.ticketplus.com.tw/config/api/v1/getS3?path=event/" + EVENT + "/";
const SESSION_IDS = {
  "12/12": "c2dea0f7d2826e50da58b304bdfd47ef",
  "12/13": "85b4b97704223ce85e10b10e07575968",
  "12/15": "95f23e400e61052b487387acfb7b1a89",
  "12/18": "99c520edfa9ddb81ad598b3fad1687cc",
  "12/19": "d042e17d71c0dc8bb3e43f08ecbc50b6",
  "12/20": "5f56e43c4c02a92b92a701ad89f88784"
};
const reply = (obj) => Response.json(obj, {
  headers: {"cache-control": "no-store", "x-robots-tag": "noindex"}
});
function summarizeShape(value) {
  const arrays = [], possibleFields = [];
  function walk(v, path, depth) {
    if (depth > 4 || arrays.length >= 15 || possibleFields.length >= 30 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      arrays.push({path, length: v.length,
        sampleKeys: v.length && v[0] && typeof v[0] === "object" ? Object.keys(v[0]).slice(0,25) : []});
      if (v.length) walk(v[0], path + "[0]", depth + 1);
      return;
    }
    for (const [k,child] of Object.entries(v)) {
      if (/^(?:session|stock|remain|ticket|sale|sold|buy|status|time|date|start|end|display)/i.test(k)) {
        possibleFields.push({
          path: path + "." + k, 
          type: Array.isArray(child) ? "array" : typeof child,
          value: (["string","number","boolean"].includes(typeof child))
            ? String(child).slice(0,90) : undefined
        });
      }
      if (typeof child === "object" && child !== null) walk(child, path + "." + k, depth + 1);
      if (arrays.length >= 15 || possibleFields.length >= 30) break;
    }
  }
  walk(value, "$", 0);
  return {rootType: Array.isArray(value) ? "array" : typeof value,
    topLevelKeys: value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).slice(0,25) : [],
    arrays, possibleFields};
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response("Ready. /check tests event.json; /sessions-check tests sessions.json.", {
      headers: {"content-type":"text/plain; charset=utf-8", "cache-control":"no-store"}
    });
    if (request.method !== "GET" || (path !== "/check" && path !== "/sessions-check" && path !== "/sessions-summary" && path !== "/event-fields" && path !== "/status-probe" && path !== "/all-status" && path !== "/monitor-preview" && path !== "/stock-schema")) {
      return new Response("Not found", {status:404});
    }
    if (path === "/stock-schema") {
      // Read-only feasibility probe for session vs. ticket area/product signals.
      // Nothing here triggers Telegram, KV writes, purchases, or a schedule.
      try {
        const result = {};
        for (const file of ["products", "ticketAreas"]) {
          const response = await fetch(BASE + file + ".json", {method:"GET",redirect:"manual"});
          result[file+"Http"]=response.status;
          if (!response.ok) return reply({...result,observation:"SOURCE_NOT_ACCESSIBLE"});
          const json=await response.json();
          const list=json && Array.isArray(json[file])?json[file]:null;
          result[file+"RootKeys"]=json && typeof json==="object"?Object.keys(json).slice(0,8):[];
          result[file+"Count"]=list?.length ?? null;
          result[file+"SampleKeys"]=list?.length?Object.keys(list[0]).slice(0,30):[];
          if (!list) return reply({...result,observation:"UNEXPECTED_SOURCE_SCHEMA"});
          result[file+"IdsHaveSession"]=list.some(item=>item && Object.values(SESSION_IDS).includes(item.sessionId));
          result[file+"CountsBySession"]=Object.fromEntries(
            Object.entries(SESSION_IDS).map(([label,sessionId])=>
              [label,list.filter(item=>item?.sessionId===sessionId).length]
            )
          );
          // Confirm field names before trying inventory-aware alerts.
          result[file+"StatusFields"]=list.length?
            Object.keys(list[0]).filter(key=>/status|count|limit|stock|sale|sold/i.test(key)):[];
          result[file+"SampleId"]=file==="products"?
            String(list[0]?.productId||"").slice(0,25):String(list[0]?.ticketAreaId||"").slice(0,25);
        }
        result.note="Schema discovery only; zero ticket availability conclusions. No notifications sent.";
        return reply(result);
      } catch(e) {
        return reply({observation:"SCHEMA_READ_FAILED",errorType:e?.name||"Error"});
      }
    }
    if (path === "/monitor-preview") {
      try { return reply(await dryRunStatus(env)); }
      catch(e) {
        const message=String(e?.message||"");
        const safeReason=message.startsWith("Official API inaccessible")
          ? "API_HTTP_OR_CONTENT_TYPE"
          : message==="Official API returned application error"
            ? "API_APPLICATION_ERROR"
            : message==="Incomplete official session list"
              ? "API_SESSION_COUNT"
              : message==="Missing or duplicate official session identifier"
                ? "API_SESSION_ID"
                : message==="Unexpected or missing official status"
                  ? "API_UNEXPECTED_STATUS"
                  : "UNEXPECTED_READ_ERROR";
        return reply({
          apiReadSuccess:false, observation:"UNKNOWN", failedStage:"official_status_read",
          errorCode:safeReason, errorType:e?.name||"Error",
          upstreamDiagnostic:e?.safeDiagnostic||null,
          note:"No schedule, KV writes or Telegram alerts were run. This reports only the official API error code and JSON field names."
        });
      }
    }
    if (path === "/all-status") {
      // The six public session URLs correspond to these non-secret backend IDs,
      // independently verified against the 12/12 result; one read-only query.
      const sessionMap = [
        ["12/12（六）18:30", "s000002288"],
        ["12/13（日）18:30", "s000002289"],
        ["12/15（二）19:30", "s000002290"],
        ["12/18（五）19:30", "s000002291"],
        ["12/19（六）18:30", "s000002292"],
        ["12/20（日）18:30", "s000002293"]
      ];
      const query = new URLSearchParams({
        eventId:"e000001534", sessionId:sessionMap.map(x=>x[1]).join(",")
      });
      const url = "https://apis.ticketplus.com.tw/config/api/v1/get?" + query.toString();
      try {
        const response = await fetch(url,{method:"GET",redirect:"manual"});
        const report={
          source:"Ticket Plus official status API",
          checkedAtTaipei:new Date().toLocaleString("sv-SE",{timeZone:"Asia/Taipei"}),
          httpStatus:response.status,
          success:response.ok,
          expectedSessions:6
        };
        if (!response.ok) {
          report.observation=response.status===403?"REQUEST_BLOCKED":"OTHER_RESPONSE";
          return reply(report);
        }
        const json=await response.json();
        const list=Array.isArray(json?.result?.session)?json.result.session:[];
        const byId=new Map(list.filter(x=>x && typeof x.id==="string").map(x=>[x.id,x]));
        report.apiErrorCode=json?.errCode??null;
        report.returnedSessions=list.length;
        report.sessions=sessionMap.map(([label,id])=>({
          label, backendId:id,
          status:typeof byId.get(id)?.status==="string" ? byId.get(id).status : "unknown",
          matched:byId.has(id)
        }));
        report.allSixMatched=report.sessions.every(x=>x.matched);
        report.note="Status is a sale-state signal, NOT verified live ticket inventory. No alerts or purchases.";
        return reply(report);
      } catch (error) {
        return reply({source:"Ticket Plus official status API",observation:"REQUEST_FAILED",
          errorType:error?.name || "UnknownError"});
      }
    }
    if (path === "/status-probe") {
      // Read-only, one session. The IDs are public event/session identifiers
      // used by the site; no login information or credentials.
      const apiUrl = "https://apis.ticketplus.com.tw/config/api/v1/get"
        + "?eventId=e000001534&sessionId=s000002288";
      try {
        const res = await fetch(apiUrl, {method:"GET", redirect:"manual"});
        const report = {source:"Ticket Plus status API", date:"2026-12-12",
          httpStatus:res.status, success:res.ok,
          contentType:res.headers.get("content-type")};
        if (!res.ok) {
          report.observation = res.status === 403 ? "REQUEST_BLOCKED" : "OTHER_RESPONSE";
          return reply(report);
        }
        const body = await res.text();
        if (body.length > 500_000) return reply({...report,observation:"TOO_LARGE_TO_INSPECT"});
        try {
          const data = JSON.parse(body);
          const list = data && data.result && data.result.session;
          report.jsonParsed = true;
          report.topLevelKeys = data && typeof data === "object" ? Object.keys(data).slice(0,12) : [];
          report.resultKeys = data?.result && typeof data.result === "object" ? Object.keys(data.result).slice(0,15) : [];
          report.sessionCount = Array.isArray(list) ? list.length : 0;
          report.sessions = Array.isArray(list) ? list.slice(0,3).map(x=>({
            keys:x && typeof x === "object" ? Object.keys(x).slice(0,30) : [],
            status:x?.status,
            id:x?.sessionId || x?.id || null,
            hasTicketCounts: x && typeof x === "object"
              ? Object.keys(x).some(k=>/remain|stock|available|quantity|quota/i.test(k)) : false
          })) : [];
          report.note = "Status alone is not proof of actual available tickets; verify against official UI.";
        } catch {
          report.jsonParsed = false;
        }
        return reply(report);
      } catch (e) {
        return reply({source:"Ticket Plus status API",observation:"REQUEST_FAILED",errorType:e?.name||"UnknownError"});
      }
    }
    const filename = (path === "/check" || path === "/event-fields") ? "event.json" : "sessions.json";
    try {
      const res = await fetch(BASE + filename, {method:"GET",redirect:"manual"});
      const result = {
        source: "Ticket Plus official event resource", file:filename,
        httpStatus:res.status, success:res.ok,
        contentType:res.headers.get("content-type"),
        observation:res.status===403?"REQUEST_BLOCKED":res.ok?"RESPONSE_RECEIVED":"OTHER_RESPONSE"
      };
      if (!res.ok) return reply(result);
      const data = await res.text();
      if (data.length > 500_000) return reply({...result, observation:"TOO_LARGE_TO_INSPECT"});
      try {
        const parsed = JSON.parse(data);
        result.jsonParsed = true;
        if (path === "/event-fields") {
          const fields = [];
          let visited = 0;
          const significant = /(?:status|sale|sold|stock|remain|ticket|buy|session|quota|limit|quantity|isopen|sell|open|stop|start|end|available|銷售|售票|票券|開賣)/i;
          function walk(value, pathName, depth) {
            if (++visited > 4000 || depth > 6 || fields.length >= 65 || value == null) return;
            if (Array.isArray(value)) {
              if (value.length) walk(value[0], pathName + "[0]", depth + 1);
              return;
            }
            if (typeof value !== "object") return;
            for (const [key,child] of Object.entries(value)) {
              const nextPath = pathName + "." + key;
              if (significant.test(key)) {
                fields.push({
                  path: nextPath, type:Array.isArray(child)?"array":typeof child,
                  sample: typeof child === "number" || typeof child === "boolean"
                    ? child : (typeof child === "string" ? child.slice(0,70) : undefined),
                  count:Array.isArray(child)?child.length:undefined
                });
              }
              if (child && typeof child === "object") walk(child,nextPath,depth+1);
              if (fields.length >= 65 || visited > 4000) break;
            }
          }
          walk(parsed,"$",0);
          result.fieldCount = fields.length;
          result.fields = fields;
          result.note = "Event metadata is not live stock. Ticket-related fields need independent positive availability validation.";
          return reply(result);
        }
        if (path === "/sessions-summary") {
          const list = parsed && Array.isArray(parsed.sessions) ? parsed.sessions : [];
          result.sessionCount = list.length;
          result.sessions = list.map((session) => ({
            sessionId: String(session.sessionId || "").slice(0,40),
            date: String(session.date || "").slice(0,45),
            time: String(session.time || "").slice(0,45),
            hidden: session.hidden,
            ticketArea: session.ticketArea,
            exposeStart: session.exposeStart,
            exposeEnd: session.exposeEnd,
            possibleStatusKeys: Object.keys(session).filter(k => /status|sold|remain|stock|available|buy|sale|expose|ticket/i.test(k)),
            validKnownId: Object.values(SESSION_IDS).includes(String(session.sessionId||""))
          }));
          result.allSixMatched = result.sessionCount === 6 && result.sessions.every(x=>x.validKnownId);
          return reply(result);
        }
        result.shape = summarizeShape(parsed);
        const serialized = JSON.stringify(parsed);
        result.sessionsMentioned = Object.fromEntries(Object.entries(SESSION_IDS).map(([label,id]) =>
          [label,serialized.includes(id)]));
      } catch {
        result.jsonParsed = false;
      }
      return reply(result);
    } catch (e) {
      return reply({observation:"REQUEST_FAILED", errorType:e?.name || "UnknownError"});
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledMonitor(env));
  }
};
