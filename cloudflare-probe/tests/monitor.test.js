import test from 'node:test';
import assert from 'node:assert/strict';
import {SESSIONS,decide,readOfficialStatus,makeTelegramText,dryRunStatus,shouldSaveHeartbeat} from '../monitor.js';

const sold=()=>Object.fromEntries(SESSIONS.map(s=>[s.id,"soldout"]));
function fakeReply(rows,errCode="00") {
  return async()=>({
    ok:true,status:200,
    headers:{get:()=>"application/json; charset=utf-8"},
    json:async()=>({errCode,result:{session:rows}})
  });
}
test("six sessions have unique keys and urls",()=>{
  assert.equal(SESSIONS.length,6);
  assert.equal(new Set(SESSIONS.map(s=>s.id)).size,6);
  assert.equal(new Set(SESSIONS.map(s=>s.hex)).size,6);
});
test("six sold out sessions: no alarms",()=>{
  const {next,pending}=decide({},sold());
  assert.equal(pending.length,0);
  assert.equal(Object.keys(next).length,6);
});
test("only 12/19 onsale: alert 12/19 not other 5",()=>{
  const cur=sold();cur["s000002292"]="onsale";
  const {pending}=decide({},cur);
  assert.equal(pending.length,1);
  assert.equal(pending[0].session.date,"2026-12-19");
  assert.match(makeTelegramText(pending[0],"2026-10-20 18:41:00"),/d042e17d71c0dc8bb3e43f08ecbc50b6/);
});
test("notified onsale does not repeat",()=>{
  const cur=sold();cur["s000002288"]="onsale";
  const {next,pending}=decide({"s000002288":{status:"onsale",notified:true}},cur);
  assert.equal(pending.length,0);
  assert.equal(next["s000002288"].notified,true);
});
test("onsale after soldout resends",()=>{
  const cur=sold();cur["s000002288"]="onsale";
  const {pending}=decide({"s000002288":{status:"soldout",notified:false}},cur);
  assert.equal(pending.length,1);
});
test("sending failure must be retried",()=>{
  const cur=sold();cur["s000002288"]="onsale";
  const {pending}=decide({"s000002288":{status:"onsale",notified:false}},cur);
  assert.equal(pending.length,1);
});
test("invalid result does not qualify as status",async()=>{
  await assert.rejects(readOfficialStatus(fakeReply([{id:"s000002288",status:"onsale"}])),/Incomplete/);
});
test("all six exact public identifiers can be parsed",async()=>{
  const rows=SESSIONS.map(s=>({id:s.id,status:"soldout"}));
  assert.deepEqual(await readOfficialStatus(fakeReply(rows)),sold());
});
test("duplicate internal id rejected",async()=>{
  const rows=SESSIONS.map(s=>({id:s.id,status:"soldout"}));rows[5].id=rows[0].id;
  await assert.rejects(readOfficialStatus(fakeReply(rows)),/duplicate/);
});
test("unexpected status rejected",async()=>{
  const rows=SESSIONS.map(s=>({id:s.id,status:"soldout"}));rows[0].status="unknown";
  await assert.rejects(readOfficialStatus(fakeReply(rows)),/Unexpected/);
});
test("telegram message includes correct direct order URL",()=>{
  const alert={session:SESSIONS[4],priorStatus:"soldout"};
  const msg=makeTelegramText(alert,"2026-10-20 18:41");
  assert.match(msg,/12\/19/);
  assert.match(msg,/d042e17d71c0dc8bb3e43f08ecbc50b6/);
  assert.match(msg,/onsale/);
});

test("official API success is reported despite a failed KV read",async()=>{
  const rows=SESSIONS.map(x=>({id:x.id,status:"soldout"}));
  const env={TICKET_STATE:{get:async()=>{throw Error("test KV read failure");}}};
  const result=await dryRunStatus(env,fakeReply(rows));
  assert.equal(result.apiReadSuccess,true);
  assert.equal(result.stateStorageConfigured,true);
  assert.equal(result.stateStorageReadable,false);
  assert.equal(result.storageError,"KV_READ_FAILED");
  assert.equal(result.readyForSchedule,false);
  assert.equal(result.sessions.length,6);
});
test("missing KV never disguises valid six-session status",async()=>{
  const rows=SESSIONS.map(x=>({id:x.id,status:"soldout"}));
  const result=await dryRunStatus({},fakeReply(rows));
  assert.equal(result.apiReadSuccess,true);
  assert.equal(result.storageError,"KV_BINDING_MISSING");
  assert.equal(result.stateStorageConfigured,false);
});
test("all prerequisite flags alone do not bypass missing KV read",async()=>{
  const rows=SESSIONS.map(x=>({id:x.id,status:"soldout"}));
  const env={
    MONITOR_ENABLED:"true",TELEGRAM_BOT_TOKEN:"TEST_ONLY",
    TELEGRAM_CHAT_ID:"TEST_ONLY",TICKET_STATE:{get:async()=>null}
  };
  const result=await dryRunStatus(env,fakeReply(rows));
  assert.equal(result.apiReadSuccess,true);
  assert.equal(result.stateStorageReadable,true);
  assert.equal(result.readyForSchedule,true);
});

test("HTTP 200 with a nonzero API error code safely exposes its shape",async()=>{
  const rows=SESSIONS.map(x=>({id:x.id,status:"soldout"}));
  const failed=fakeReply(rows,"4010");
  await assert.rejects(readOfficialStatus(failed),err=>{
    assert.equal(err.message,"Official API returned application error");
    assert.equal(err.safeDiagnostic.upstreamErrorCode,"4010");
    assert.equal(err.safeDiagnostic.hasSessionArray,true);
    assert.equal(err.safeDiagnostic.sessionCount,6);
    return true;
  });
});
test("an HTTP 200 API response without session list cannot produce an alert",async()=>{
  const failed=async()=>({ok:true,status:200,headers:{get:()=> "application/json"},json:async()=>({errCode:"0",result:{event:{}}})});
  await assert.rejects(readOfficialStatus(failed),err=>{
    assert.equal(err.safeDiagnostic.upstreamErrorCode,"0");
    assert.equal(err.safeDiagnostic.hasSessionArray,false);
    return true;
  });
});

test("real-world API errCode 00 is accepted with all six soldout",async()=>{
  const rows=SESSIONS.map(x=>({id:x.id,status:"soldout"}));
  assert.deepEqual(await readOfficialStatus(fakeReply(rows,"00")),sold());
});
test("legacy API errCode 0 remains accepted",async()=>{
  const rows=SESSIONS.map(x=>({id:x.id,status:"soldout"}));
  assert.deepEqual(await readOfficialStatus(fakeReply(rows,"0")),sold());
});
test("other codes cannot be mistaken for success",async()=>{
  const rows=SESSIONS.map(x=>({id:x.id,status:"soldout"}));
  for(const code of ["01","000","4010",null]){
    await assert.rejects(readOfficialStatus(fakeReply(rows,code)),/application error/);
  }
});

test("preview reports previous successful scheduler checkpoint without writing KV",async()=>{
  const rows=SESSIONS.map(x=>({id:x.id,status:"soldout"}));
  let writes=0;
  const env={TICKET_STATE:{
    get:async()=>({version:1,sessions:{},checkedAt:"2026-10-20T11:10:00.000Z"}),
    put:async()=>{writes++;}
  }};
  const result=await dryRunStatus(env,fakeReply(rows));
  assert.equal(result.apiReadSuccess,true);
  assert.equal(result.lastSavedMonitorCheck,"2026-10-20T11:10:00.000Z");
  assert.equal(writes,0);
});

test("five-minute Cron heartbeat is persisted after four-minute safety margin",()=>{
  const current=new Date("2026-10-20T11:40:00Z");
  assert.equal(shouldSaveHeartbeat("2026-10-20T11:35:00Z",current),true);
  assert.equal(shouldSaveHeartbeat("2026-10-20T11:36:01Z",current),false);
  assert.equal(shouldSaveHeartbeat("2026-10-20T11:36:00Z",current),true);
  assert.equal(shouldSaveHeartbeat("",current),true);
  assert.equal(shouldSaveHeartbeat("bad-timestamp",current),true);
});
