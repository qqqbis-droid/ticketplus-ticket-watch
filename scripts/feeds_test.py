"""One-shot READ-ONLY check for free public news feed access; prints counts only."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
import xml.etree.ElementTree as ET

q='田馥甄 (釋票 OR 清票 OR 加開 OR 開賣 OR 餘票) when:30d'
urls=[
 ("google_news_rss","https://news.google.com/rss/search?"+urlencode({"q":q,"hl":"zh-TW","gl":"TW","ceid":"TW:zh-Hant"})),
 ("ptt_she_atom","https://www.ptt.cc/atom/S.H.E.xml"),
]
for label,url in urls:
 try:
  req=Request(url,headers={"User-Agent":"Mozilla/5.0 (compatible; PersonalAnnouncementMonitor/0.1)","Accept":"application/rss+xml,application/atom+xml,application/xml,text/xml"})
  with urlopen(req,timeout=15) as response:
   data=response.read(250_000)
   print("SOURCE",label,"http",response.status,"type",response.headers.get("content-type"),"bytes",len(data))
  root=ET.fromstring(data)
  items=root.findall("./channel/item") if root.tag=="rss" else root.findall("{http://www.w3.org/2005/Atom}entry")
  print("PARSED",label,"items",len(items))
  for item in items[:3]:
   title=item.findtext("title") or item.findtext("{http://www.w3.org/2005/Atom}title") or ""
   print("HEADLINE",label,title[:100])
 except HTTPError as err:
  print("HTTP_ERROR",label,err.code)
 except (URLError,TimeoutError,ValueError,ET.ParseError) as err:
  print("FETCH_ERROR",label,type(err).__name__)
