// Ticket Plus read-only Cloudflare diagnostics. NO cron, login, purchases or retries.
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
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response("Ready. /check tests event.json; /sessions-check tests sessions.json.", {
      headers: {"content-type":"text/plain; charset=utf-8", "cache-control":"no-store"}
    });
    if (request.method !== "GET" || (path !== "/check" && path !== "/sessions-check")) {
      return new Response("Not found", {status:404});
    }
    const filename = path === "/check" ? "event.json" : "sessions.json";
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
  }
};
