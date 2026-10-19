"""Read-only public-page network diagnostics.

No authentication, no cookies persisted, no bypasses, no ticket clicks.
Only response metadata; query strings/redacted values never logged.
"""
import json, time, urllib.parse
from collections import Counter
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

PAGE="https://ticketplus.com.tw/activity/af2bd66d8fe65d78963cbb5bdc85771c"
def sanitized(url):
    p=urllib.parse.urlsplit(url)
    # Domain + path only: never print query, credentials or fragments.
    return p.netloc+p.path[:140]

o=Options()
o.add_argument("--headless=new")
o.add_argument("--no-sandbox")
o.add_argument("--disable-dev-shm-usage")
o.add_argument("--window-size=390,844")
o.add_argument("--lang=zh-TW")
o.set_capability("goog:loggingPrefs",{"performance":"ALL","browser":"ALL"})
driver=webdriver.Chrome(options=o)
driver.set_page_load_timeout(30)
try:
    driver.get(PAGE)
    for sec in [8,23]:
        time.sleep(sec)
        print("CHECK",sec,"title=",driver.title,"landed=",sanitized(driver.current_url))
        print("BODY",repr(driver.find_element(By.TAG_NAME,"body").text[:250]).replace("\n"," "))
    rows={}
    errors={}
    for entry in driver.get_log("performance"):
        try:
            data=json.loads(entry["message"])["message"]
        except Exception:continue
        method=data.get("method","")
        params=data.get("params",{})
        if method=="Network.responseReceived":
            response=params.get("response",{})
            u=sanitized(response.get("url",""))
            # Print domain/path and status only. Cap and avoid trackers/static noise.
            typ=params.get("type","")
            if typ in ("XHR","Fetch") or response.get("status",0)>=400:
                k=(str(response.get("status")),typ,u)
                rows[k]=rows.get(k,0)+1
        if method=="Network.loadingFailed":
            errors[str(params.get("errorText",""))[:130]]=errors.get(str(params.get("errorText",""))[:130],0)+1
    print("FETCH_RESPONSES",json.dumps([{"status":k[0],"type":k[1],"path":k[2],"n":v} for k,v in rows.items()][:70],ensure_ascii=False))
    print("NETWORK_ERRORS",json.dumps(errors,ensure_ascii=False))
    print("BROWSER_ERRORS",json.dumps([{"level":x["level"],"message":x["message"][:250]} for x in driver.get_log("browser")[:12]],ensure_ascii=False))
finally:driver.quit()
