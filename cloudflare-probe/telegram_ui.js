/**
 * One-tap Telegram UI for the existing Ticket Plus bot.
 *
 * Security:
 *   - Outgoing requests use Cloudflare secret TELEGRAM_BOT_TOKEN only.
 *   - Incoming Telegram webhooks require a secret_token header derived from
 *     the same private token and must match the configured private chat/user.
 *   - All ticket checks are read-only; no login, queue, reservations or buying.
 *   - Manual checks never modify the scheduled monitor's sale-state baseline.
 */
import {SESSIONS, readOfficialStatus} from "./monitor.js";

const WEBHOOK_URL = "https://ticketplus-check.qqqbis.workers.dev/telegram-webhook";
const UI_STATE_KEY = "ticketplus:telegram-ui:v1";
const MANUAL_LAST_KEY = "ticketplus:telegram-ui:last-manual:v1";
const BUTTON_TEXT = "🔄 立即查六場";
const CALLBACK_DATA = "ticketplus_check_six_v1";
const INTERVAL_MS = 15000;
const REPLY_KEYBOARD = {
  keyboard: [[{text:BUTTON_TEXT}]],
  resize_keyboard: true,
  is_persistent: true
};
const INLINE_KEYBOARD = {
  inline_keyboard: [[{text:BUTTON_TEXT,callback_data:CALLBACK_DATA}]]
};

export {UI_STATE_KEY,BUTTON_TEXT,CALLBACK_DATA};

function enabled(env) {
  return env?.MONITOR_ENABLED==="true" && Boolean(env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID && env?.TICKET_STATE);
}

function validChat(env,chatId,fromId,chatType) {
  const allowed=String(env?.TELEGRAM_CHAT_ID||"");
  // This integration is intentionally for the existing single private chat.
  return /^\d+$/.test(allowed) && String(chatId)===allowed &&
    String(fromId)===allowed && chatType==="private";
}

export function isAuthorizedUpdate(env,update) {
  const callback=update?.callback_query;
  if(callback) {
    const msg=callback.message;
    return validChat(env,msg?.chat?.id,callback.from?.id,msg?.chat?.type)
      && callback.data===CALLBACK_DATA && typeof callback.id==="string";
  }
  const msg=update?.message;
  return Boolean(msg && validChat(env,msg.chat?.id,msg.from?.id,msg.chat?.type)
    && [BUTTON_TEXT,"/check","/start"].includes(msg.text));
}

export function displayStatus(status) {
  switch(status) {
    case "soldout": return "⚪ 售完（soldout）";
    case "onsale": return "🟢 開放販售訊號（請進站確認）";
    case "pending": return "⏳ 等待開賣（pending）";
    case "unavailable": return "⚪ 暫不可購（unavailable）";
    default: return "❔ 狀態未確認";
  }
}

export function formatManualStatus(current, timestamp) {
  const header=["🎫 Ticket Plus 六場最新官方狀態","🕒 台灣時間："+timestamp,""];
  const lines=SESSIONS.map(s=>{
    const label=s.date.slice(5).replace("-","/")+"（週"+s.day+"） "+s.time;
    return label+"｜"+displayStatus(current[s.id]);
  });
  const active=SESSIONS.filter(s=>current[s.id]==="onsale");
  const links=active.length?[
    "","🔗 開放販售訊號場次（點入確認）：",
    ...active.map(s=>"https://ticketplus.com.tw/order/af2bd66d8fe65d78963cbb5bdc85771c/"+s.hex)
  ]:[];
  return [...header,...lines,...links,"",
    "⚠️ 這是官方場次狀態，並非即時票區庫存。",
    "目前尚無法精準區分「暫無票券」與「銷售一空」。",
    "需要時可再次點下方按鈕重新查詢。"].join("\n");
}

async function webhookSecret(token) {
  const input=new TextEncoder().encode("ticketplus-telegram-webhook-v1:"+token);
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",input));
  return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function equalString(a,b) {
  if(typeof a!=="string" || a.length!==b.length) return false;
  let difference=0;
  for(let i=0;i<a.length;i++) difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}

export async function verifyWebhookRequest(request,env) {
  if(request.method!=="POST" || !enabled(env)) return false;
  const header=request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if(!header) return false;
  return equalString(header,await webhookSecret(env.TELEGRAM_BOT_TOKEN));
}

async function telegramApi(env,method,payload) {
  const res=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/"+method,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(payload)
  });
  if(!res.ok) throw new Error("Telegram HTTP "+res.status);
  const out=await res.json();
  if(out.ok!==true) throw new Error("Telegram API error");
  return out.result;
}

async function sendToChat(env,text,keyboard=INLINE_KEYBOARD) {
  return telegramApi(env,"sendMessage",{
    chat_id:env.TELEGRAM_CHAT_ID,text,reply_markup:keyboard,
    disable_web_page_preview:true
  });
}

async function answerCallback(env,callbackId,text="正在查詢六場官方狀態…") {
  if(!callbackId) return;
  try{await telegramApi(env,"answerCallbackQuery",{callback_query_id:callbackId,text,show_alert:false});}
  catch(e){console.warn("Telegram callback ACK failed",e?.name||"Error");}
}

export async function handleTelegramUpdate(env,update,
  {readStatuses=readOfficialStatus,sendMessage=sendToChat,ack=answerCallback}={}) {
  if(!isAuthorizedUpdate(env,update)) return {accepted:false};
  const cb=update.callback_query;
  const msg=update.message;
  if(msg?.text==="/start") {
    await sendMessage(env,"✅ 六場搶票雷達已連線！\n請點下方「🔄 立即查六場」，就會立即重新查詢六場官方狀態。",REPLY_KEYBOARD);
    return {accepted:true,welcome:true};
  }
  if(cb) await ack(env,cb.id);
  const now=Date.now();
  // A minimum 15s per chat prevents rapid tapping and repeated API calls.
  let last=0;
  try {last=Number(await env.TICKET_STATE.get(MANUAL_LAST_KEY))||0;}
  catch(e){console.warn("Telegram manual rate-limit KV read unavailable");}
  if(now-last<INTERVAL_MS) {
    if(cb) await ack(env,cb.id,"剛查過囉，請稍後再點一次");
    return {accepted:true,rateLimited:true};
  }
  try{await env.TICKET_STATE.put(MANUAL_LAST_KEY,String(now),{expirationTtl:120});}
  catch(e){console.warn("Telegram manual rate-limit KV write unavailable");}
  let message;
  try {
    const current=await readStatuses();
    const taipeiTime=new Intl.DateTimeFormat("sv-SE",{
      timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false
    }).format(new Date());
    message=formatManualStatus(current,taipeiTime);
  }catch(e){
    message="⚠️ 目前無法取得完整的六場官方狀態，請稍後點按鈕重試。這不代表已經有票。";
  }
  await sendMessage(env,message,INLINE_KEYBOARD);
  return {accepted:true,checked:true};
}

export async function registerButtonUI(env) {
  if(!enabled(env)) return {registered:false,reason:"DISABLED_OR_UNCONFIGURED"};
  const old=await env.TICKET_STATE.get(UI_STATE_KEY,{type:"json"});
  if(old?.ready===true && old?.version===1) return {registered:true,alreadyReady:true};
  const current=await telegramApi(env,"getWebhookInfo",{});
  if(current?.url && current.url!==WEBHOOK_URL) {
    console.warn("Bot has a different pre-existing webhook; setup stopped");
    return {registered:false,reason:"OTHER_WEBHOOK_EXISTS"};
  }
  const secret=await webhookSecret(env.TELEGRAM_BOT_TOKEN);
  await telegramApi(env,"setWebhook",{
    url:WEBHOOK_URL,
    secret_token:secret,
    allowed_updates:["message","callback_query"],
    drop_pending_updates:false
  });
  // Proactively deliver a one-tap button; no user typing is necessary.
  await sendToChat(env,
    "✅ Ticket Plus 搶票雷達：一鍵查票已加入！\n\n點下方「🔄 立即查六場」即可當下查詢六場，不必輸入指令。原本每五分鐘自動監控會繼續運作。",
    REPLY_KEYBOARD);
  await env.TICKET_STATE.put(UI_STATE_KEY,JSON.stringify({
    ready:true,version:1,registeredAt:new Date().toISOString()
  }));
  return {registered:true};
}

export async function getButtonUIStatus(env) {
  const state=env?.TICKET_STATE?await env.TICKET_STATE.get(UI_STATE_KEY,{type:"json"}):null;
  const lastManual=env?.TICKET_STATE?await env.TICKET_STATE.get(MANUAL_LAST_KEY):null;
  return {
    enabled:Boolean(env?.MONITOR_ENABLED==="true"),
    telegramConfigured:Boolean(env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID),
    buttonSetupReady:state?.ready===true,
    registeredAt:state?.registeredAt||null,
    lastManualCheckAt:lastManual?new Date(Number(lastManual)).toISOString():null,
    instructions:"When ready, open existing Telegram bot chat and tap 🔄 立即查六場. Existing five-minute Cron is unchanged."
  };
}
