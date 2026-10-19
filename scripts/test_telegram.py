"""Send exactly one explicitly labeled test message. No ticket status is checked."""
import json,os,sys,urllib.parse,urllib.request,urllib.error

def send_test(token:str,chat_id:str):
    if not token or not chat_id:
        print("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in GitHub Actions secrets.")
        return 2
    if not chat_id.lstrip("-").isdigit():
        print("TELEGRAM_CHAT_ID must be a numeric private-chat/user ID.")
        return 2
    text=("🧪 Ticket Plus 六場搶票雷達\n"
          "✅ Telegram 通知連線測試成功。\n"
          "⚠️ 這只是測試通知，不代表有票！\n"
          "⚠️ 正式票況監測尚未啟動，因為售票網站的公開資料來源回傳 HTTP 403。")
    payload=urllib.parse.urlencode({"chat_id":chat_id,"text":text,
                                   "disable_web_page_preview":"true"}).encode()
    req=urllib.request.Request(
        "https://api.telegram.org/bot"+token+"/sendMessage",
        data=payload,method="POST")
    try:
        with urllib.request.urlopen(req,timeout=20) as resp:
            data=json.loads(resp.read())
            if data.get("ok") is not True:
                print("Telegram response did not confirm successful delivery.")
                return 1
        print("SUCCESS: Telegram TEST notification was accepted (NOT a ticket alert).")
        return 0
    except urllib.error.HTTPError as exc:
        # Do not print URL or full exception text; token is in request path.
        print(f"Telegram HTTP {exc.code}. Check secrets, bot START and chat ID.")
        return 1
    except Exception as exc:
        print("Telegram request failed:",type(exc).__name__)
        return 1

if __name__=="__main__":
    sys.exit(send_test(os.environ.get("TELEGRAM_BOT_TOKEN",""),
                       os.environ.get("TELEGRAM_CHAT_ID","")))
