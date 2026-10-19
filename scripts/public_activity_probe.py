import json, time
from pathlib import Path
from selenium.webdriver.common.by import By
from src.ticket_watch import make_browser
url="https://ticketplus.com.tw/activity/af2bd66d8fe65d78963cbb5bdc85771c"
b=make_browser()
try:
    b.get(url)
    time.sleep(7)
    print("TARGET",url)
    print("LANDED",b.current_url)
    print("TITLE",b.title)
    print("BODY",repr(b.find_element(By.TAG_NAME,"body").text[:12000]))
    elements=b.execute_script("""return [...document.querySelectorAll('button,a,tr,li,[role=button]')].slice(0,150).map(e=>({tag:e.tagName,txt:(e.innerText||'').trim().slice(0,180),disabled:!!e.disabled,visible:!!e.getClientRects().length,href:e.href||null}));""")
    print("ELEMENTS",json.dumps(elements,ensure_ascii=False))
    Path("diagnostics").mkdir(exist_ok=True)
    b.save_screenshot("diagnostics/activity.png")
finally:
    b.quit()
