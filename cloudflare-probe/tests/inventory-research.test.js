import test from "node:test";
import assert from "node:assert/strict";
import {SESSIONS} from "../monitor.js";
import {
  RESEARCH_STATE_KEY,RESEARCH_EVIDENCE_KEY,
  shouldRunResearch,readZoneSnapshot,evaluateZoneChange,runZoneResearch,getResearchStatus
} from "../inventory_research.js";

function syntheticSnapshot() {
  const products={},areas={},summary={};
  for(const s of SESSIONS) {
    summary[s.id]={
      date:s.date,time:s.time,products:2,areas:2,
      nonSoldoutProducts:0,nonSoldoutAreas:0,positiveCounts:0,
      nonSoldoutSamples:[]
    };
    for(let i=0;i<2;i++) {
      products["p_"+s.id+"_"+i]=[s.hex,"soldout",null,false];
      areas["a_"+s.id+"_"+i]=[s.hex,"soldout",null,false];
    }
  }
  return {products,areas,summary};
}
function mkEnv() {
  const map=new Map(),writes=[];
  return {
    MONITOR_ENABLED:"true",RESEARCH_ENABLED:"true",
    TELEGRAM_BOT_TOKEN:"test_token",TELEGRAM_CHAT_ID:"123",
    TICKET_STATE:{
      get:async(key)=>map.has(key)?JSON.parse(map.get(key)):null,
      put:async(key,value)=>{writes.push(key);map.set(key,value);}
    },
    _map:map,_writes:writes
  };
}
function clone(obj){return JSON.parse(JSON.stringify(obj));}

test("five-minute zone scan gates from scheduled timestamps independently of one-minute Cron",()=>{
  assert.equal(shouldRunResearch(Date.parse("2026-10-20T12:00:00Z")),true);
  assert.equal(shouldRunResearch(Date.parse("2026-10-20T12:01:00Z")),false);
  assert.equal(shouldRunResearch(Date.parse("2026-10-20T12:05:00Z")),true);
  assert.equal(shouldRunResearch("unparsable"),false);
});
test("all-soldout initial scan establishes state WITHOUT any alert",async()=>{
  const env=mkEnv(),sent=[];
  const result=await runZoneResearch(env,{
    now:new Date("2026-10-20T12:05:00Z"),
    readSnapshot:async()=>syntheticSnapshot(),
    notify:async(_env,message)=>{sent.push(message);return true;}
  });
  assert.equal(result.validRead,true);
  assert.equal(result.alerts,0);
  assert.equal(sent.length,0);
  const saved=JSON.parse(env._map.get(RESEARCH_STATE_KEY));
  assert.equal(saved.signs[SESSIONS[0].id].active,false);
  assert.equal(saved.snapshot.summary[SESSIONS[0].id].products,2);
  assert.equal(env._map.has(RESEARCH_EVIDENCE_KEY),false);
});
test("first new pending status saves durable evidence BEFORE notifying and correctly names session",async()=>{
  const env=mkEnv(),first=syntheticSnapshot();
  await runZoneResearch(env,{now:new Date("2026-10-20T12:05:00Z"),readSnapshot:async()=>first});
  const changed=clone(first);
  const s=SESSIONS[4];
  changed.products["p_"+s.id+"_0"][1]="pending";
  changed.summary[s.id].nonSoldoutProducts=1;
  let evidenceSeenDuringSend=false; const messages=[];
  const result=await runZoneResearch(env,{
    now:new Date("2026-10-20T12:10:00Z"),readSnapshot:async()=>changed,
    notify:async(_env,message)=>{
      evidenceSeenDuringSend=env._map.has(RESEARCH_EVIDENCE_KEY);
      messages.push(message);return true;
    }
  });
  assert.equal(result.alerts,1);
  assert.equal(evidenceSeenDuringSend,true);
  assert.equal(messages.length,1);
  assert.match(messages[0],/12\/19/);
  assert.match(messages[0],/不是已確認/);
  assert.match(messages[0],/d042e17d71c0dc8bb3e43f08ecbc50b6/);
  const evidence=JSON.parse(env._map.get(RESEARCH_EVIDENCE_KEY)).records;
  assert.equal(evidence.length,1);
  assert.equal(evidence[0].changedEntries,1);
  assert.equal(evidence[0].changes[0].before.status,"soldout");
  assert.equal(evidence[0].changes[0].after.status,"pending");
  assert.equal(JSON.parse(env._map.get(RESEARCH_STATE_KEY)).pendingAlerts.length,0);
});
test("an unchanged suspicious status never repeats alerts and heartbeat is 15m",async()=>{
  const env=mkEnv(),snap=syntheticSnapshot();
  const s=SESSIONS[0];
  snap.products["p_"+s.id+"_0"][1]="unavailable";
  let calls=0;
  await runZoneResearch(env,{
    now:new Date("2026-10-20T12:05:00Z"),readSnapshot:async()=>snap,
    notify:async()=>{calls++;return true;}
  });
  const writesBefore=env._writes.length;
  await runZoneResearch(env,{
    now:new Date("2026-10-20T12:10:00Z"),readSnapshot:async()=>snap,
    notify:async()=>{calls++;return true;}
  });
  assert.equal(calls,1);
  assert.equal(env._writes.length,writesBefore);
  await runZoneResearch(env,{now:new Date("2026-10-20T12:20:00Z"),readSnapshot:async()=>snap});
  assert.equal(env._writes.length,writesBefore+1);
});
test("a stronger onsale signal after weaker status gets one escalation alert",()=>{
  const before=syntheticSnapshot(),s=SESSIONS[1];
  before.products["p_"+s.id+"_0"][1]="pending";
  const old={snapshot:before,signs:evaluateZoneChange(null,before,"now").signs};
  const after=clone(before);
  after.products["p_"+s.id+"_0"][1]="onsale";
  const result=evaluateZoneChange(old,after,"later");
  assert.equal(result.alerts.length,1);
  assert.equal(result.alerts[0].id,s.id);
  assert.match(result.alerts[0].reason,/升級/);
});
test("positive numeric count is evidence for research but not confirmed purchasable tickets",()=>{
  const snap=syntheticSnapshot();
  const s=SESSIONS[2];
  snap.areas["a_"+s.id+"_1"][2]=2;
  const result=evaluateZoneChange({snapshot:syntheticSnapshot()},snap,"now");
  assert.equal(result.alerts.length,1);
  assert.equal(result.alerts[0].examples[0].count,2);
});
test("after signal disappears, returning to soldout does not alert",()=>{
  const old=syntheticSnapshot(),s=SESSIONS[2];
  old.areas["a_"+s.id+"_1"][1]="lock";
  const previous={snapshot:old,signs:evaluateZoneChange(null,old,"then").signs};
  const next=syntheticSnapshot();
  const result=evaluateZoneChange(previous,next,"now");
  assert.equal(result.alerts.length,0);
  assert.equal(result.changedCount,1);
});
test("unavailable official API never overwrites evidence or sends Telegram",async()=>{
  const env=mkEnv();let calls=0;
  const result=await runZoneResearch(env,{
    readSnapshot:async()=>{throw Error("HTTP 403");},
    notify:async()=>{calls++;return true;}
  });
  assert.equal(result.validRead,false);
  assert.equal(env._writes.length,0);
  assert.equal(calls,0);
});
test("failed Telegram sends retain pending notification for retry",async()=>{
  const env=mkEnv(),snap=syntheticSnapshot(),s=SESSIONS[3];
  snap.products["p_"+s.id+"_0"][1]="pending";
  let calls=0;
  await runZoneResearch(env,{
    now:new Date("2026-10-20T12:05:00Z"),readSnapshot:async()=>snap,
    notify:async()=>{calls++;return false;}
  });
  let state=JSON.parse(env._map.get(RESEARCH_STATE_KEY));
  assert.equal(state.pendingAlerts.length,1);
  await runZoneResearch(env,{
    now:new Date("2026-10-20T12:10:00Z"),readSnapshot:async()=>snap,
    notify:async()=>{calls++;return true;}
  });
  state=JSON.parse(env._map.get(RESEARCH_STATE_KEY));
  assert.equal(calls,2);
  assert.equal(state.pendingAlerts.length,0);
});
test("read-only research status contains no secrets and exposes saved baseline",async()=>{
  const env=mkEnv();
  await runZoneResearch(env,{now:new Date("2026-10-20T12:05:00Z"),readSnapshot:async()=>syntheticSnapshot()});
  const basic=await getResearchStatus(env);
  assert.equal(basic.enabled,true);
  assert.equal(basic.researchCadenceMinutes,5);
  assert.equal(basic.observedCounts.products,12);
  assert.equal(basic.observedCounts.ticketAreas,12);
  assert.equal(basic.sessions.length,6);
  assert.equal(JSON.stringify(basic).includes("test_token"),false);
});
test("complete official API batches require every one of six dates and valid status",async()=>{
  const allP=[],allA=[];
  for(const s of SESSIONS) {
    for(let i=0;i<72;i++) allP.push({productId:"p"+s.id+"_"+i,sessionId:s.hex,hidden:false});
    for(let i=0;i<66;i++) allA.push({ticketAreaId:"a"+s.id+"_"+i,sessionId:s.hex,hidden:false});
  }
  let officialCalls=0;
  const fake=async(url)=>{
    officialCalls++;
    const u=new URL(url);
    let obj;
    if(u.searchParams.get("path")?.endsWith("products.json")) obj={products:allP};
    else if(u.searchParams.get("path")?.endsWith("ticketAreas.json")) obj={ticketAreas:allA};
    else if(u.searchParams.has("productId")) {
      obj={errCode:"00",result:{product:u.searchParams.get("productId").split(",").map(id=>({id,status:"soldout"}))}};
    } else if(u.searchParams.has("ticketAreaId")) {
      obj={errCode:"00",result:{ticketArea:u.searchParams.get("ticketAreaId").split(",").map(id=>({id,status:"soldout"}))}};
    } else throw Error("bad URL");
    return {ok:true,status:200,headers:{get:()=> "application/json"},json:async()=>obj};
  };
  const snapshot=await readZoneSnapshot(fake);
  assert.equal(Object.keys(snapshot.products).length,432);
  assert.equal(Object.keys(snapshot.areas).length,396);
  assert.equal(officialCalls,17);
  assert.ok(SESSIONS.every(s=>snapshot.summary[s.id].products===72 && snapshot.summary[s.id].areas===66));
});
test("incomplete dynamic responses fail closed rather than producing false stock alerts",async()=>{
  const fake=async url=>{
    const u=new URL(url);
    if(u.searchParams.get("path")?.endsWith("products.json")) return {
      ok:true,status:200,headers:{get:()=> "application/json"},
      json:async()=>({products:SESSIONS.map(s=>({productId:"p_"+s.id,sessionId:s.hex}))})
    };
    if(u.searchParams.get("path")?.endsWith("ticketAreas.json")) return {
      ok:true,status:200,headers:{get:()=> "application/json"},
      json:async()=>({ticketAreas:SESSIONS.map(s=>({ticketAreaId:"a_"+s.id,sessionId:s.hex}))})
    };
    return {ok:true,status:200,headers:{get:()=> "application/json"},
      json:async()=>({errCode:"00",result:{product:[],ticketArea:[]}})};
  };
  await assert.rejects(readZoneSnapshot(fake),/DYNAMIC_RECORDS_INCOMPLETE/);
});
