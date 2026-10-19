"""Check public event resource availability without auth or bypass attempts."""
import json, socket,urllib.request,urllib.error
from urllib.parse import urlparse
u="https://apis.ticketplus.com.tw/config/api/v1/getS3?path=event/af2bd66d8fe65d78963cbb5bdc85771c/event.json"
host=urlparse(u).hostname
try:
    addrs=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
    print("DNS_RESULT",host,len(addrs),"addresses")
except Exception as e:print("DNS_FAIL",type(e).__name__,str(e)[:250])
for name,headers in (("anonymous",{"Accept":"application/json"}),("ordinary-origin",{"Accept":"application/json","Origin":"https://ticketplus.com.tw"})):
    req=urllib.request.Request(u,headers=headers,method="GET")
    try:
        with urllib.request.urlopen(req,timeout=15) as res:
            body=res.read(3000)
            print("RESPONSE",name,"status",res.status,"type",res.headers.get("Content-Type"),"cors",res.headers.get("Access-Control-Allow-Origin"),"length",res.headers.get("Content-Length"),"snippet",repr(body[:160]))
            if body.startswith((b"{",b"[")):
                try:
                    obj=json.loads(body)
                    print("JSON_TOP_LEVEL",list(obj)[:20] if isinstance(obj,dict) else "list")
                except Exception:pass
    except urllib.error.HTTPError as e:
        print("HTTP_ERROR",name,"status",e.code,"type",e.headers.get("content-type"),"cors",e.headers.get("Access-Control-Allow-Origin"),"retry",e.headers.get("Retry-After"))
    except Exception as e:
        print("NETWORK_ERROR",name,type(e).__name__,str(e)[:200])
