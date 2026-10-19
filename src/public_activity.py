"""Public Ticket Plus activity-page rows only; no login, clicks, or CAPTCHA bypass."""
import argparse,json,os,re,sys,time,urllib.parse,urllib.request
from pathlib import Path
from src.ticket_watch import ROOT,is_expired,load_json,make_browser
URL="https://ticketplus.com.tw/activity/af2bd66d8fe65d78963cbb5bdc85771c"
SOLD=re.compile(r"銷售一空|已售完|售罄|全數售完")
BUY=re.compile(r"^(立即購買|立即購票)$")

def classify_row(row):
    if row.get("loading"): return "unknown"
    status=str(row.get("status_text",""))
    if SOLD.search(status): return "sold_out"
    for b in row.get("status_controls",[]):
        if (BUY.fullmatch(b.get("text","").strip()) and b.get("visible") is True
                and b.get("enabled") is True and b.get("blue") is True
                and not b.get("blocked") and not SOLD.search(b.get("surrounding_text",""))):
            return "available"
    return "unknown"

def classify_activity(snapshot,dates):
    unknown={d:"unknown" for d in dates}
    if (not snapshot.get("ok") or snapshot.get("landed_url") != URL
            or snapshot.get("blocked") or snapshot.get("loading") or snapshot.get("login_required")):
        return unknown,"Invalid or incomplete page"
    rows={d:[] for d in dates}
    for row in snapshot.get("rows",[]):
        if row.get("date") in rows:
            rows[row["date"]].append(row)
    if any(len(rows[d]) != 1 for d in dates):
        return unknown,"Six distinct dated rows not loaded"
    return {d:classify_row(rows[d][0]) for d in dates},"Six dated rows checked"

JS=r"""
const dateRx=/2026\s*[-/.年]\s*12\s*[-/.月]\s*(12|13|15|18|19|20)(?:\s*日)?/g;
const rgb=str=>{let m=str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);return m?m.slice(1).map(Number):null};
const blue=e=>[e,e.parentElement,e.parentElement?.parentElement].filter(Boolean).some(n=>{
  const s=getComputedStyle(n),a=[rgb(s.backgroundColor),rgb(s.color)];
  return a.some(c=>c && c[2]>c[0]*1.25 && c[2]>c[1]*1.12 && c[2]>80);
});
let rows=[];
for(const tr of document.querySelectorAll('tr,[role="row"]')){
  const text=(tr.innerText||'').trim(), matches=[...text.matchAll(dateRx)];
  if(matches.length!==1)continue;
  const cells=[...tr.querySelectorAll(':scope > td,:scope > [role="cell"]')];
  const statusCell=cells.length>=4?cells[cells.length-1]:tr;
  const status=(statusCell.innerText||'').trim();
  const ctrls=[...statusCell.querySelectorAll('button,a,[role="button"]')].map(el=>({
    text:(el.innerText||el.getAttribute('aria-label')||'').trim(),
    visible:!!el.getClientRects().length,
    enabled:!el.disabled && el.getAttribute('aria-disabled')!=='true' && getComputedStyle(el).pointerEvents!=='none',
    blue:blue(el),blocked:el.matches('[disabled],[aria-disabled="true"]'),
    surrounding_text:(el.parentElement?.innerText||'').slice(0,200)
  }));
  rows.push({date:'2026-12-'+matches[0][1].padStart(2,'0'),
    status_text:status.slice(0,250),status_controls:ctrls,
    loading:/Loading\.{0,3}|載入中/.test(status)});
}
const body=document.body?.innerText||'';
return {rows,loading:/Loading\.{0,3}/.test(body),
  login_required:/(?:請先登入|會員登入.*密碼)/.test(body),
  excerpt:body.slice(0,1000)};
"""

def read(browser):
    browser.get(URL)
    time.sleep(8)
    snap=browser.execute_script(JS)
    snap.update(ok=True,landed_url=browser.current_url.split("?")[0].rstrip("/"))
    return snap

def notify(event):
    payload=urllib.parse.urlencode({
      "chat_id":os.environ["TELEGRAM_CHAT_ID"],
      "text":f"🎟️ 可能重新開賣：{event['label']}\n活動頁對應場次已顯示可點擊的藍色『立即購買』。\n{event['url']}\n票況可能隨時變動。",
      "disable_web_page_preview":"true"}).encode()
    req=urllib.request.Request("https://api.telegram.org/bot"+os.environ["TELEGRAM_BOT_TOKEN"]+"/sendMessage",data=payload)
    try:
        with urllib.request.urlopen(req,timeout=12) as response:
            return bool(json.loads(response.read().decode()).get("ok"))
    except Exception as e:
        print("Notification failed:",type(e).__name__)
        return False

def main():
    p=argparse.ArgumentParser();p.add_argument("--mode",choices=["probe","monitor"],default="probe")
    mode=p.parse_args().mode
    events=load_json(ROOT/"config/events.json",[])
    if is_expired(): print("Ended");return 0
    if mode=="monitor" and (
        os.environ.get("PUBLIC_ACTIVITY_VERIFIED")!="true" or
        os.environ.get("MONITOR_ENABLED")!="true" or
        not os.environ.get("TELEGRAM_BOT_TOKEN") or not os.environ.get("TELEGRAM_CHAT_ID")):
        print("Public-page monitoring is not verified/configured. Disabled.");return 0
    b=None
    try:
        b=make_browser();snap=read(b)
    except Exception as e:
        print("Safe read failure; no notifications:",type(e).__name__);return 1
    finally:
        if b:b.quit()
    states,reason=classify_activity(snap,[e["date"] for e in events])
    print(reason,json.dumps(states,ensure_ascii=False))
    if mode=="probe":
        out=ROOT/"diagnostics";out.mkdir(exist_ok=True)
        (out/"public-activity.json").write_text(json.dumps(snap,ensure_ascii=False,indent=2))
        print("Probe only: no alerts sent.")
        return 0
    path=ROOT/"state/activity_state.json"
    state=load_json(path,{"statuses":{}})
    for event in events:
        d=event["date"];current=states[d];prev=state["statuses"].get(d,"unknown")
        if current=="sold_out":
            state["statuses"][d]="sold_out"
        elif current=="available" and prev!="available":
            if notify(event):state["statuses"][d]="available"
    path.write_text(json.dumps(state,ensure_ascii=False,indent=2)+"\n")
    return 0
if __name__=="__main__":sys.exit(main())
