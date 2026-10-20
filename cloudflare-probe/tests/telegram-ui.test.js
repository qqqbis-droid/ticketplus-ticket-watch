import test from "node:test";
import assert from "node:assert/strict";
import {SESSIONS} from "../monitor.js";
import {
  BUTTON_TEXT, CALLBACK_DATA, isAuthorizedUpdate,
  displayStatus, formatManualStatus, handleTelegramUpdate
} from "../telegram_ui.js";

const env={
  TELEGRAM_CHAT_ID:"1234567",TELEGRAM_BOT_TOKEN:"test-only",
  MONITOR_ENABLED:"true"
};
const message=(text,chatType="private",fromId=1234567)=>({
  message:{text,chat:{id:1234567,type:chatType},from:{id:fromId}}
});
const callback=(data,fromId=1234567)=>({
  callback_query:{
    id:"12345:abc",data,from:{id:fromId},
    message:{chat:{id:1234567,type:"private"}}
  }
});
const statuses=(state="soldout")=>Object.fromEntries(SESSIONS.map(s=>[s.id,state]));
function mkEnv() {
  const memory=new Map();
  return {
    ...env,
    TICKET_STATE:{
      get:async key=>memory.get(key)??null,
      put:async(key,val)=>{memory.set(key,val);}
    }
  };
}
test("private approved reply keyboard touch is accepted",()=>{
  assert.equal(isAuthorizedUpdate(env,message(BUTTON_TEXT)),true);
  assert.equal(isAuthorizedUpdate(env,callback(CALLBACK_DATA)),true);
  assert.equal(isAuthorizedUpdate(env,message("/start")),true);
});
test("unrecognized messages, users, group chats and tampered callbacks are refused",()=>{
  assert.equal(isAuthorizedUpdate(env,message("hello")),false);
  assert.equal(isAuthorizedUpdate(env,message(BUTTON_TEXT,"group")),false);
  assert.equal(isAuthorizedUpdate(env,message(BUTTON_TEXT,"private",678)),false);
  assert.equal(isAuthorizedUpdate(env,callback(CALLBACK_DATA,678)),false);
  assert.equal(isAuthorizedUpdate(env,callback("any_invalid_query")),false);
  assert.equal(isAuthorizedUpdate({...env,TELEGRAM_CHAT_ID:"-1234567"},message(BUTTON_TEXT)),false);
  assert.equal(isAuthorizedUpdate(env,{message:{text:BUTTON_TEXT,chat:{id:0,type:"private"},from:{id:0}}}),false);
});
test("one tap queries SIX only when authorized; independent of cron",async()=>{
  const worker=mkEnv();
  const sent=[],acks=[];
  let calls=0;
  const result=await handleTelegramUpdate(worker,callback(CALLBACK_DATA),{
    readStatuses:async()=>{calls++;return statuses();},
    sendMessage:async(_env,text,keyboard)=>{sent.push({text,keyboard});},
    ack:async(_env,id)=>acks.push(id)
  });
  assert.equal(result.checked,true);
  assert.equal(calls,1);
  assert.equal(acks.length,1);
  assert.equal(sent.length,1);
  assert.equal((sent[0].text.match(/（週/g)||[]).length,6);
  assert.match(sent[0].text,/暫無票券/);
  assert.match(sent[0].keyboard.inline_keyboard[0][0].text,/立即查六場/);
});
test("fast repeated taps cannot generate repeated status API checks",async()=>{
  const worker=mkEnv();
  let calls=0,sends=0;
  const overrides={readStatuses:async()=>{calls++;return statuses();},
    sendMessage:async()=>sends++,ack:async()=>null};
  await handleTelegramUpdate(worker,message(BUTTON_TEXT),overrides);
  const res=await handleTelegramUpdate(worker,message(BUTTON_TEXT),overrides);
  assert.equal(res.rateLimited,true);
  assert.equal(calls,1);
  assert.equal(sends,1);
});
test("private /start returns a permanent one-tap keyboard with no status fetch",async()=>{
  const worker=mkEnv();let sends=[],reads=0;
  const result=await handleTelegramUpdate(worker,message("/start"),{
    readStatuses:async()=>{reads++;return statuses();},
    sendMessage:async(_env,text,keyboard)=>sends.push({text,keyboard})
  });
  assert.equal(result.welcome,true);
  assert.equal(reads,0);
  assert.equal(sends[0].keyboard.keyboard[0][0].text,BUTTON_TEXT);
});
test("manual check unavailable only returns a safe failure message",async()=>{
  const worker=mkEnv();const sent=[];
  const result=await handleTelegramUpdate(worker,message(BUTTON_TEXT),{
    readStatuses:async()=>{throw Error("API failed");},
    sendMessage:async(_env,text)=>sent.push(text)
  });
  assert.equal(result.checked,true);
  assert.equal(sent.length,1);
  assert.match(sent[0],/無法取得完整/);
  assert.doesNotMatch(sent[0],/有票了|成功釋票/);
});
test("manual check onsale wording does not promise available stock",()=>{
  const content=formatManualStatus(statuses("onsale"),"2026-10-20 20:10:00");
  assert.match(content,/開放販售訊號/);
  assert.match(content,/並非即時票區庫存/);
  assert.match(content,/ticketplus.com.tw\/order/);
});
test("unknown status is not labeled confirmed sale",()=>{
  assert.match(displayStatus("unknown"),/未確認/);
  assert.match(displayStatus("soldout"),/售完/);
});
