"""One-shot read-only bridge check: GitHub -> user Cloudflare Worker (never Ticket Plus)."""
from urllib.request import Request, urlopen
import json
URL="https://ticketplus-check.qqqbis.workers.dev/all-status"
req=Request(URL,headers={"Accept":"application/json"})
with urlopen(req,timeout=20) as r:
    data=json.loads(r.read(80_000))
    print("WORKER_HTTP",r.status)
    print("UPSTREAM_HTTP",data.get("httpStatus"))
    print("API_CODE",data.get("apiErrorCode"))
    print("MATCHED_SIX",data.get("allSixMatched"))
    sessions=data.get("sessions",[])
    print("RETURNED_SESSIONS",len(sessions))
    for s in sessions:
        print("SESSION",s.get("backendId"),s.get("status"),s.get("matched"))
    assert r.status==200
    assert data.get("httpStatus")==200 and data.get("apiErrorCode")=="0"
    assert data.get("allSixMatched") is True and len(sessions)==6
