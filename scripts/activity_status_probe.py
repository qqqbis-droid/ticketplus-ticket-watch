"""Read-only diagnosis of the *public activity page*, never presses buy or logs in."""
import json
import time
from pathlib import Path
from selenium.webdriver.common.by import By
from src.ticket_watch import make_browser

URL="https://ticketplus.com.tw/activity/af2bd66d8fe65d78963cbb5bdc85771c"
out=Path("diagnostics");out.mkdir(exist_ok=True)
browser=make_browser()
try:
    browser.get(URL)
    for seconds in (10, 32, 55):
        time.sleep(seconds - (0 if seconds==10 else 10 if seconds==32 else 32))
        raw=browser.execute_script("""
        const text=(document.body?.innerText || '').slice(0,12000);
        const candidates=[...document.querySelectorAll('tr,[role=row],tbody > *,li,button,a')].filter(x => {
            let s=(x.innerText||'').trim();
            return /12\\/12|12\\/13|12\\/15|12\\/18|12\\/19|12\\/20|2026-12|售票狀態|已售完|立即購買|立即購票|Loading/.test(s);
        }).slice(0,80).map(x=>({
           tag:x.tagName, cls:String(x.className||'').slice(0,170),
           text:(x.innerText||'').trim().slice(0,300),
           visible:!!x.getClientRects().length, disabled: !!x.disabled,
           href:x.getAttribute('href'),
           color:getComputedStyle(x).color,
           bg:getComputedStyle(x).backgroundColor
        }));
        return {body:text, candidates};
        """)
        print("SNAPSHOT",seconds,"LANDED",browser.current_url, json.dumps(raw,ensure_ascii=False),flush=True)
        browser.save_screenshot(str(out/f"activity-{seconds}.png"))
finally:
    browser.quit()
