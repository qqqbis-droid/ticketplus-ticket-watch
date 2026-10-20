"""One shot anonymous read-only diagnostics. Never retries or varies identity."""
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
url="https://apis.ticketplus.com.tw/config/api/v1/getS3?path=event/af2bd66d8fe65d78963cbb5bdc85771c/event.json"
request=Request(url,method="GET")
try:
    response=urlopen(request,timeout=12)
    print("HTTP",response.status,"CONTENT_TYPE",response.headers.get("content-type"))
except HTTPError as e:
    print("HTTP",e.code)
    for key in ("server","content-type","x-amzn-waf-action","x-cache","via","x-amzn-errortype","cf-mitigated","retry-after"):
        value=e.headers.get(key)
        if value:print("HEADER",key,str(value)[:150])
    body=e.read(400)
    lower=body.lower()
    for indicator in (b"cloudfront",b"access denied",b"forbidden",b"captcha",b"waf",b"request blocked",b"cloudflare"):
        if indicator in lower:print("BODY_INDICATOR",indicator.decode())
except (TimeoutError,URLError) as e:
    print("NETWORK_ERROR",type(e).__name__)
