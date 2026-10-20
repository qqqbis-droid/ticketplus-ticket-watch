import test from 'node:test';
import assert from 'node:assert/strict';
import {SESSIONS,decide,readOfficialStatus,makeTelegramText,dryRunStatus} from '../monitor.js';

const sold=()=>Object.fromEntries(SESSIONS.map(s=>[s.id,"soldout"]));
function fakeReply(rows,errCode="0") {
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
