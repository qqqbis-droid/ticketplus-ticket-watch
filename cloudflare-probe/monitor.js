/**
 * Official Ticket Plus sale-state monitor. Runs in Cloudflare only.
 * No login, no auto-purchase, no CAPTCHA, no retries or bypasses.
 *
 * "onsale" is a possible sale reopening signal, NOT live ticket inventory.
 */
const EVENT_ID = "af2bd66d8fe65d78963cbb5bdc85771c";
const INTERNAL_EVENT = "e000001534";
export const SESSIONS = Object.freeze([
  {date:"2026-12-12", time:"18:30", day:"\u516d", id:"s000002288", hex:"c2dea0f7d2826e50da58b304bdfd47ef"},
  {date:"2026-12-13", time:"18:30", day:"\u65e5", id:"s000002289", hex:"85b4b97704223ce85e10b10e07575968"},
  {date:"2026-12-15", time:"19:30", day:"\u4e8c", id:"s000002290", hex:"95f23e400e61052b487387acfb7b1a89"},
  {date:"2026-12-18", time:"19:30", day:"\u4e94", id:"s000002291", hex:"99c520edfa9ddb81ad598b3fad1687cc"},
  {date:"2026-12-19", time:"18:30", day:"\u516d", id:"s000002292", hex:"d042e17d71c0dc8bb3e43f08ecbc50b6"},
  {date:"2026-12-20", time:"18:30", day:"\u65e5", id:"s000002293", hex:"5f56e43c4c02a92b92a701ad89f88784"}
]);
const VALID = new Set(["soldout","onsale","pending","unavailable"]);
const URL="https://apis.ticketplus.com.tw/config/api/v1/get?"
  + new URLSearchParams({eventId:INTERNAL_EVENT, sessionId:SESSIONS.map(x=>x.id).join(",")});
export const STORE_KEY = "ticketplus:state:v1";

export async function readOfficialStatus(fetchFn=fetch) {
  // Match the exact request options used by the independently successful /all-status probe.
  const resp=await fetchFn(URL,{method:"GET",redirect:"manual"});
  if(!resp.ok || !String(resp.headers.get("content-type")||"").includes("application/json")) {
    throw new Error("Official API inaccessible or invalid response: "+resp.status);
  }
  const json=await resp.json();
  if(!["0","00"].includes(String(json?.errCode)) || !Array.isArray(json?.result?.session)) {
    // The official endpoint sometimes returns an application-level error under
    // HTTP 200. Expose only its numeric/string code and response shape, never
    // any session body, private data, cookies, credentials or full errMsg.
    const error=new Error("Official API returned application error");
    error.safeDiagnostic={
      upstreamErrorCode:json?.errCode==null ? null : String(json.errCode).slice(0,32),
      hasSessionArray:Array.isArray(json?.result?.session),
      sessionCount:Array.isArray(json?.result?.session) ? json.result.session.length : null,
      rootKeys:json && typeof json==="object" ? Object.keys(json).slice(0,12) : [],
      resultKeys:json?.result && typeof json.result==="object" ? Object.keys(json.result).slice(0,12) : []
    };
    throw error;
  }
  const rows=json.result.session;
  if(rows.length!==SESSIONS.length) throw new Error("Incomplete official session list");
  const map=new Map();
  for(const row of rows) {
    if(!row || typeof row.id!=="string" || map.has(row.id)) {
      throw new Error("Missing or duplicate official session identifier");
    }
    map.set(row.id,row.status);
  }
  const current={};
  for(const session of SESSIONS) {
    const status=map.get(session.id);
    if(!VALID.has(status)) throw new Error("Unexpected or missing official status");
    current[session.id]=status;
  }
  return current;
}

export function decide(previous, current) {
  const old=previous && typeof previous==="object" ? previous : {};
  const next={};
  const pending=[];
  for(const session of SESSIONS) {
    const status=current[session.id];
    if(!VALID.has(status)) throw new Error("Invalid status in evaluation");
    const before=old[session.id] || {};
    const priorStatus=before.status || "unknown";
    const wasNotified=before.status==="onsale" && before.notified===true;
    next[session.id]={
      status,
      notified:status==="onsale" ? wasNotified : false
    };
    if(status==="onsale" && !wasNotified) {
      pending.push({session,priorStatus});
    }
  }
  return {next,pending};
}

export function makeTelegramText({session, priorStatus}, checkedAt) {
  const date=session.date.slice(5).replace("-","/");
  const sessionLabel=date+" (\u9031"+session.day+") "+session.time;
  const orderUrl="https://ticketplus.com.tw/order/"+EVENT_ID+"/"+session.hex;
  return [
    "\u{1F3AB} Ticket Plus \u53ef\u80fd\u91cd\u65b0\u958b\u8ce3",
    "\u5834\u6b21\uff1a"+sessionLabel,
    "\u5b98\u65b9\u72c0\u614b\uff1a"+priorStatus+" \u2192 onsale",
    "\u67e5\u8a62\u6642\u9593\uff08\u53f0\u5317\uff09\uff1a"+checkedAt,
    "\u524d\u5f80\u8a72\u5834\u8cfc\u7968\uff1a"+orderUrl,
    "\u6ce8\u610f\uff1aonsale \u4e0d\u4ee3\u8868\u4e00\u5b9a\u6709\u5269\u9918\u7968\u5238\uff0c\u8acb\u9032\u7ad9\u78ba\u8a8d\u3002"
  ].join("\n");
}

async function sendTelegram(env, text) {
  const params=new URLSearchParams({
    chat_id:env.TELEGRAM_CHAT_ID,
    text,
    disable_web_page_preview:"true"
  });
  const res=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{
    method:"POST",body:params,
    headers:{"content-type":"application/x-www-form-urlencoded"}
  });
  if(!res.ok) return false;
  try {return (await res.json()).ok === true;}catch{return false;}
}


export function shouldSaveHeartbeat(lastCheck, now) {
  const previous=Date.parse(lastCheck||"");
  return !Number.isFinite(previous) || now.getTime()-previous>=4*60*1000;
}

export async function runScheduledMonitor(env) {
  // Explicit activation gate prevents accidental alerts before final verification.
  if(env.MONITOR_ENABLED!=="true" || !env.TICKET_STATE || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.log("Ticket Plus monitoring disabled: missing enable flag, KV, or Telegram secrets");
    return {enabled:false};
  }
  const now=new Date();
  const localDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  if(localDate>"2026-12-20") return {enabled:false,ended:true};
  let current;
  try {current=await readOfficialStatus();}
  catch(e) {
    console.warn("Ticket Plus API check failed; no notifications",e?.message || "Unknown error");
    return {enabled:true,validRead:false};
  }
  const stored=await env.TICKET_STATE.get(STORE_KEY,{type:"json"});
  const old=stored && stored.version===1 ? stored.sessions : {};
  const {next,pending}=decide(old,current);
  const checkedAt=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(now);
  const delivered=[];
  for(const alert of pending) {
    try {
      if(await sendTelegram(env,makeTelegramText(alert,checkedAt))) {
        next[alert.session.id].notified=true;
        delivered.push(alert.session.id);
      }
    } catch (e) {console.warn("Telegram failed for session",alert.session.id,e?.name || "Error");}
  }
  // KV write on transitions/Telegram delivery, plus once per scheduled 5-min
  // interval when a read succeeded. A 4-minute minimum prevents duplicates
  // from consuming free KV writes if a scheduled event runs unusually soon.
  const previousString=JSON.stringify(old || {});
  const change=JSON.stringify(next)!==previousString;
  const lastCheck=stored?.checkedAt || "";
  const heartbeat=shouldSaveHeartbeat(lastCheck,now);
  if(change || heartbeat) {
    await env.TICKET_STATE.put(STORE_KEY,JSON.stringify({version:1,sessions:next,checkedAt:now.toISOString()}));
  }
  console.log("Official six-status check OK; notifications sent",delivered.length);
  return {enabled:true,validRead:true,delivered:delivered.length};
}

export async function dryRunStatus(env, fetchFn=fetch) {
  // Independently report source-reading and Cloudflare KV errors. One failure
  // must not be mislabeled as a Ticket Plus API failure.
  const current=await readOfficialStatus(fetchFn);
  let old={};
  let storageReadable=false;
  let storageError=null;
  let lastStoredCheck=null;
  if(env.TICKET_STATE) {
    try {
      const stored=await env.TICKET_STATE.get(STORE_KEY,{type:"json"});
      old=stored && stored.version===1 && stored.sessions ? stored.sessions : {};
      lastStoredCheck=stored?.version===1 && typeof stored.checkedAt==="string" ? stored.checkedAt : null;
      storageReadable=true;
    } catch (e) {
      storageError="KV_READ_FAILED";
    }
  } else {
    storageError="KV_BINDING_MISSING";
  }
  const {pending}=decide(old,current);
  return {
    source:"Ticket Plus official sale-state API",
    liveInventoryVerified:false,
    apiReadSuccess:true,
    stateStorageConfigured:!!env.TICKET_STATE,
    stateStorageReadable:storageReadable,
    storageError,
    lastSavedMonitorCheck:lastStoredCheck,
    telegramConfigured:Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    enabled:env.MONITOR_ENABLED==="true",
    readyForSchedule:storageReadable &&
      Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) &&
      env.MONITOR_ENABLED==="true",
    sessions:SESSIONS.map(s=>({
      date:s.date,time:s.time,status:current[s.id],
      wouldNotifyOnNextRun:pending.some(x=>x.session.id===s.id)
    })),
    note:"This is a read-only preview. No alerts were sent, and no KV state was changed."
  };
}
