/**
 * Ticket Plus evidence-only ticket-zone research. Runs inside the existing
 * Cloudflare Worker once every five minutes, independently of the one-minute
 * session onsale monitor.
 *
 * The official API does NOT yet provide a verified mapping to the UI string
 * "暫無票券". Never claim that a zone anomaly equals bookable inventory.
 * All requests are public read-only GET; no login, orders, queues or bypasses.
 */
import {SESSIONS} from "./monitor.js";

export const RESEARCH_STATE_KEY="ticketplus:research:state:v1";
export const RESEARCH_EVIDENCE_KEY="ticketplus:research:evidence:v1";
const EVENT_ID="af2bd66d8fe65d78963cbb5bdc85771c";
const STATIC_BASE="https://apis.ticketplus.com.tw/config/api/v1/getS3?path=event/"+EVENT_ID+"/";
const DYNAMIC_BASE="https://apis.ticketplus.com.tw/config/api/v1/get?";
const KNOWN=new Map(SESSIONS.map(x=>[x.hex,x]));
const BATCH_SIZE=60;
const MAX_RECORDS=20;
const HEARTBEAT_MS=15*60*1000;

export function shouldRunResearch(scheduledTime) {
  const date=new Date(scheduledTime);
  return !Number.isNaN(date.getTime()) && date.getUTCMinutes()%5===0;
}

async function getJson(url,fetchFn) {
  const res=await fetchFn(url,{method:"GET",redirect:"manual"});
  if(!res.ok || !String(res.headers.get("content-type")||"").includes("json")) {
    throw Error("SOURCE_NOT_JSON_OR_HTTP_"+res.status);
  }
  return res.json();
}

function chunks(items,size=BATCH_SIZE) {
  const parts=[];
  for(let i=0;i<items.length;i+=size) parts.push(items.slice(i,i+size));
  return parts;
}

async function fetchDynamic(key,resultKey,ids,fetchFn) {
  const parts=chunks(ids);
  const records=new Map();
  for(let i=0;i<parts.length;i+=3) {
    const results=await Promise.all(parts.slice(i,i+3).map(pack=>
      getJson(DYNAMIC_BASE+new URLSearchParams({[key]:pack.join(",")}),fetchFn)));
    for(const body of results) {
      if(!["0","00"].includes(String(body?.errCode)) || !Array.isArray(body?.result?.[resultKey])) {
        throw Error("DYNAMIC_API_ERROR");
      }
      for(const item of body.result[resultKey]) {
        if(!item || typeof item.id!=="string" || records.has(item.id)) {
          throw Error("INVALID_OR_DUPLICATE_DYNAMIC_ID");
        }
        if(typeof item.status!=="string" || !item.status.trim() || item.status.length>40) {
          throw Error("MISSING_OR_UNEXPECTED_DYNAMIC_STATUS");
        }
        const count=typeof item.count==="number" && Number.isFinite(item.count) && item.count>=0
          ? item.count : null;
        const limit=item[resultKey==="product"?"productLimit":"ticketAreaLimit"];
        records.set(item.id,{
          s:item.status,
          c:count,
          l:typeof limit==="boolean"?limit:null
        });
      }
    }
  }
  if(records.size!==ids.length || ids.some(id=>!records.has(id))) {
    throw Error("DYNAMIC_RECORDS_INCOMPLETE");
  }
  return records;
}

export async function readZoneSnapshot(fetchFn=fetch) {
  const [staticProducts,staticAreas]=await Promise.all([
    getJson(STATIC_BASE+"products.json",fetchFn),
    getJson(STATIC_BASE+"ticketAreas.json",fetchFn)
  ]);
  if(!Array.isArray(staticProducts?.products) || !Array.isArray(staticAreas?.ticketAreas)) {
    throw Error("STATIC_SCHEMA_INVALID");
  }
  const productInfo=new Map(),areaInfo=new Map();
  for(const obj of staticProducts.products) {
    if(!KNOWN.has(obj?.sessionId)||obj.hidden===true) continue;
    if(typeof obj.productId!=="string" || productInfo.has(obj.productId)) {
      throw Error("STATIC_PRODUCT_ID_INVALID");
    }
    productInfo.set(obj.productId,obj.sessionId);
  }
  for(const obj of staticAreas.ticketAreas) {
    if(!KNOWN.has(obj?.sessionId)||obj.hidden===true) continue;
    if(typeof obj.ticketAreaId!=="string" || areaInfo.has(obj.ticketAreaId)) {
      throw Error("STATIC_AREA_ID_INVALID");
    }
    areaInfo.set(obj.ticketAreaId,obj.sessionId);
  }
  if(productInfo.size<SESSIONS.length || areaInfo.size<SESSIONS.length ||
    productInfo.size>600 || areaInfo.size>600) {
    throw Error("UNEXPECTED_ZONE_COUNT");
  }
  const productIds=[...productInfo.keys()].sort();
  const areaIds=[...areaInfo.keys()].sort();
  const pDynamic=await fetchDynamic("productId","product",productIds,fetchFn);
  const aDynamic=await fetchDynamic("ticketAreaId","ticketArea",areaIds,fetchFn);
  const products={},areas={},summary={};
  for(const s of SESSIONS) summary[s.id]={
    date:s.date,time:s.time,products:0,areas:0,
    nonSoldoutProducts:0,nonSoldoutAreas:0,positiveCounts:0,nonSoldoutSamples:[]
  };
  for(const [id,sessionHex] of [...productInfo].sort((a,b)=>a[0].localeCompare(b[0]))) {
    const x=pDynamic.get(id);
    products[id]=[sessionHex,x.s,x.c,x.l];
    const sum=summary[KNOWN.get(sessionHex).id];
    sum.products++;
    if(x.s!=="soldout") {
      sum.nonSoldoutProducts++;
      if(sum.nonSoldoutSamples.length<4) sum.nonSoldoutSamples.push({kind:"product",id,status:x.s,count:x.c});
    }
    if(x.c!==null && x.c>0) sum.positiveCounts++;
  }
  for(const [id,sessionHex] of [...areaInfo].sort((a,b)=>a[0].localeCompare(b[0]))) {
    const x=aDynamic.get(id);
    areas[id]=[sessionHex,x.s,x.c,x.l];
    const sum=summary[KNOWN.get(sessionHex).id];
    sum.areas++;
    if(x.s!=="soldout") {
      sum.nonSoldoutAreas++;
      if(sum.nonSoldoutSamples.length<4) sum.nonSoldoutSamples.push({kind:"area",id,status:x.s,count:x.c});
    }
    if(x.c!==null && x.c>0) sum.positiveCounts++;
  }
  if(SESSIONS.some(s=>summary[s.id].products===0 || summary[s.id].areas===0)) {
    throw Error("MISSING_SESSION_ZONES");
  }
  return {products,areas,summary};
}

function itemIsSuspicious(entry) {
  return Array.isArray(entry) && (entry[1]!=="soldout" || (typeof entry[2]==="number" && entry[2]>0));
}
function itemIsStrong(entry) {
  return Array.isArray(entry) && (entry[1]==="onsale" || (typeof entry[2]==="number" && entry[2]>0));
}
function sessionSigns(snapshot) {
  const result={};
  for(const s of SESSIONS) result[s.id]={active:false,strong:false,examples:[]};
  for(const type of ["products","areas"]) {
    for(const [id,row] of Object.entries(snapshot[type]||{})) {
      const session=KNOWN.get(row?.[0]);
      if(!session) continue;
      const r=result[session.id];
      if(itemIsSuspicious(row)) {
        r.active=true;
        if(r.examples.length<4) r.examples.push({kind:type==="products"?"票種":"票區",id,status:row[1],count:row[2]});
      }
      if(itemIsStrong(row)) r.strong=true;
    }
  }
  return result;
}

export function evaluateZoneChange(previous,current,at) {
  const oldSnapshot=previous?.snapshot||{products:{},areas:{}};
  const oldSigns=previous?.signs||sessionSigns(oldSnapshot);
  const signs=sessionSigns(current);
  const changes=[];
  let changedCount=0;
  for(const type of ["products","areas"]) {
    const before=oldSnapshot[type]||{};
    const after=current[type]||{};
    const ids=new Set([...Object.keys(before),...Object.keys(after)]);
    for(const id of ids) {
      const oldRow=before[id]||null;
      const newRow=after[id]||null;
      if(JSON.stringify(oldRow)!==JSON.stringify(newRow)) {
        changedCount++;
        if(changes.length<24) {
          const session=KNOWN.get(newRow?.[0]||oldRow?.[0]);
          changes.push({
            date:session?.date||null,kind:type==="products"?"product":"area",id,
            before:oldRow?{status:oldRow[1],count:oldRow[2],limit:oldRow[3]}:null,
            after:newRow?{status:newRow[1],count:newRow[2],limit:newRow[3]}:null
          });
        }
      }
    }
  }
  const alerts=[];
  for(const s of SESSIONS) {
    const prior=oldSigns[s.id]||{active:false,strong:false};
    const now=signs[s.id];
    const firstRise=!prior.active && now.active;
    const stronger=prior.active && !prior.strong && now.strong;
    if(firstRise||stronger) {
      alerts.push({
        date:s.date,time:s.time,id:s.id,hex:s.hex,
        reason:stronger?"從疑似異常升級為較強訊號":"首次出現新的票區／票種異常",
        examples:now.examples
      });
    }
  }
  return {
    signs,alerts,changedCount,
    evidence:{
      observedAt:at,
      initialBaseline:!previous?.snapshot,
      changedEntries:changedCount,
      changes,
      sessions:SESSIONS.map(s=>({
        date:s.date,products:current.summary[s.id].products,
        areas:current.summary[s.id].areas,
        nonSoldoutProducts:current.summary[s.id].nonSoldoutProducts,
        nonSoldoutAreas:current.summary[s.id].nonSoldoutAreas,
        positiveCounts:current.summary[s.id].positiveCounts
      })),
      note:"Unverified experimental evidence. No direct UI mapping to 暫無票券."
    }
  };
}

function makeAlertMessage(alerts,at) {
  const lines=["🔎 Ticket Plus 票區狀態異常｜研究提醒",
    "🕒 發現時間："+new Intl.DateTimeFormat("sv-SE",{
      timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false
    }).format(new Date(at)),""];
  for(const a of alerts) {
    lines.push("📍 "+a.date.slice(5).replace("-","/")+" "+a.time+"｜"+a.reason);
    lines.push("官方樣本："+a.examples.slice(0,2).map(x=>x.kind+" "+x.status+(x.count===null?"":" count="+x.count)).join("；"));
    lines.push("場次："+ "https://ticketplus.com.tw/order/"+EVENT_ID+"/"+a.hex);
  }
  lines.push("","⚠️ 這不是已確認的「暫無票券」，也不保證有票。請帶此提醒回 ChatGPT 研究。",
    "📂 研究紀錄：https://ticketplus-check.qqqbis.workers.dev/research-evidence");
  return lines.join("\n");
}

async function sendResearchAlert(env,text) {
  const res=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID,text,disable_web_page_preview:"true"})
  });
  if(!res.ok) return false;
  try{return (await res.json()).ok===true;}catch{return false;}
}

export async function runZoneResearch(env,{now=new Date(),readSnapshot=readZoneSnapshot,notify=sendResearchAlert}={}) {
  if(env?.RESEARCH_ENABLED!=="true" || !env?.TICKET_STATE ||
    !env?.TELEGRAM_BOT_TOKEN || !env?.TELEGRAM_CHAT_ID) {
    return {enabled:false};
  }
  if(now.getTime()>Date.parse("2026-12-21T00:00:00+08:00")) return {enabled:false,ended:true};
  let current;
  try {current=await readSnapshot();}
  catch(e) {
    console.warn("Research source check failed; previous evidence retained",e?.message||"Error");
    return {enabled:true,validRead:false};
  }
  const at=now.toISOString();
  const previous=await env.TICKET_STATE.get(RESEARCH_STATE_KEY,{type:"json"});
  const {signs,alerts,changedCount,evidence}=evaluateZoneChange(previous,current,at);
  const lastSaved=Date.parse(previous?.lastCheckedAt||"");
  const heartbeat=!Number.isFinite(lastSaved) || now.getTime()-lastSaved>=HEARTBEAT_MS;
  const changed=!previous?.snapshot || changedCount>0;
  // Evidence must be durably saved BEFORE any Telegram push.
  if(previous?.snapshot && changedCount>0) {
    const prior=await env.TICKET_STATE.get(RESEARCH_EVIDENCE_KEY,{type:"json"});
    const list=Array.isArray(prior?.records)?prior.records:[];
    list.unshift(evidence);
    await env.TICKET_STATE.put(RESEARCH_EVIDENCE_KEY,JSON.stringify({version:1,records:list.slice(0,MAX_RECORDS)}));
  }
  const state={
    version:1,lastCheckedAt:changed||heartbeat?at:previous.lastCheckedAt,
    lastChangedAt:changed?at:previous.lastChangedAt,
    lastAlertAt:previous?.lastAlertAt||null,
    snapshot:current,signs,
    // An undelivered warning is obsolete once the signal vanishes; never
    // send a stale "anomaly" alert after the area returns to soldout.
    pendingAlerts:(previous?.pendingAlerts||[]).filter(a=>
      signs[a.id]?.active && (!a.reason.includes("升級") || signs[a.id]?.strong))
  };
  // Preserve undelivered warnings for a later retry; do not emit stale ones.
  const pendingCleared=(previous?.pendingAlerts?.length||0)>state.pendingAlerts.length;
  if(alerts.length) state.pendingAlerts=alerts;
  let delivered=false;
  if(state.pendingAlerts.length) {
    try {delivered=await notify(env,makeAlertMessage(state.pendingAlerts,at));}
    catch(e){console.warn("Research Telegram push failed",e?.name||"Error");}
    if(delivered) {
      state.pendingAlerts=[];
      state.lastAlertAt=at;
    }
  }
  // Cloudflare KV allows no more than one write per key per second.
  // Evidence has already been saved above; commit final state only once.
  if(changed||heartbeat||pendingCleared||alerts.length||delivered) {
    await env.TICKET_STATE.put(RESEARCH_STATE_KEY,JSON.stringify(state));
  }
  console.log("Inventory research",{
    changedEntries:changedCount,alerts:alerts.length,delivered,
    products:Object.keys(current.products).length,areas:Object.keys(current.areas).length
  });
  return {enabled:true,validRead:true,changedEntries:changedCount,
    alerts:alerts.length,delivered,products:Object.keys(current.products).length,
    areas:Object.keys(current.areas).length};
}

export async function getResearchStatus(env,includeEvidence=false) {
  const state=env?.TICKET_STATE
    ?await env.TICKET_STATE.get(RESEARCH_STATE_KEY,{type:"json"}):null;
  const counts=state?.snapshot?{
    products:Object.keys(state.snapshot.products||{}).length,
    ticketAreas:Object.keys(state.snapshot.areas||{}).length
  }:null;
  const basic={
    enabled:env?.RESEARCH_ENABLED==="true",
    researchCadenceMinutes:5,
    firstBaselineSaved:state?.version===1 && Boolean(state.snapshot),
    lastSavedCheckAt:state?.lastCheckedAt||null,
    lastObservedChangeAt:state?.lastChangedAt||null,
    lastResearchAlertAt:state?.lastAlertAt||null,
    pendingAlertCount:state?.pendingAlerts?.length||0,
    observedCounts:counts,
    sessions:state?.snapshot?SESSIONS.map(s=>({
      date:s.date,time:s.time,...state.snapshot.summary[s.id]
    })):[],
    note:"This is evidence-only research. An anomaly is NOT verified UI 暫無票券 and NOT confirmed ticket stock. Research checks run every five minutes while sale-state checks run each minute. Saved last-check time updates at least every 15 minutes."
  };
  if(includeEvidence) {
    const saved=env?.TICKET_STATE
      ?await env.TICKET_STATE.get(RESEARCH_EVIDENCE_KEY,{type:"json"}):null;
    return {...basic,recentEvidence:Array.isArray(saved?.records)?saved.records.slice(0,MAX_RECORDS):[]};
  }
  return basic;
}
