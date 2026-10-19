"""Conservative read-only Ticket Plus monitor.

No login, CAPTCHA solving, purchasing or rapid retries.
Never alert without verified selectors from live page.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, date
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TZ = ZoneInfo("Asia/Taipei")
END_EXCLUSIVE = datetime(2026, 12, 21, tzinfo=TZ)
BUY_LABEL = re.compile(r"購買|選購|訂購|立即購票|選擇票價|選擇票種|加入購物車|buy|purchase", re.I)
CAPTCHA = re.compile(r"驗證碼|人機驗證|captcha|are you human|access denied|存取遭拒|cloudflare.*challenge", re.I)
SOLD_OUT = re.compile(r"(?:本場次|此場次|本活動|所有票券)(?:目前|已經)?(?:全部)?(?:已售完|售罄)|全數售完", re.I)


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def is_expired(now: datetime | None = None):
    now = now or datetime.now(TZ)
    return now.astimezone(TZ) >= END_EXCLUSIVE


def classify(snapshot: dict, rule: dict | None) -> tuple[str, str]:
    """Only independently verified, actionable ticket controls can be 'available'."""
    text = snapshot.get("body_text", "") or ""
    if not snapshot.get("ok"):
        return "unknown", "Navigation/browser error"
    if CAPTCHA.search(text) or snapshot.get("blocked"):
        return "unknown", "Verification or blocked page"
    if rule:
        css, pattern, context = (rule.get(k) for k in ("button_css", "button_text_regex", "context_text_regex"))
        if css and pattern and context:
            for match in snapshot.get("verified_matches", []):
                if not match.get("visible") or not match.get("enabled"):
                    continue
                if re.search(r"已售完|售罄|額滿|暫停販售|不可購買", match.get("context", ""), re.I):
                    continue
                if re.search(pattern, match.get("text", ""), re.I) and re.search(context, match.get("context", ""), re.I):
                    return "available", "Verified enabled buy control inside ticket context"
    if SOLD_OUT.search(text):
        return "sold_out", "Explicit full-event sold-out text"
    if any(BUY_LABEL.search(str(x.get("text", ""))) for x in snapshot.get("actions", []) if x.get("enabled")):
        return "candidate", "Unverified CTA; cannot notify as buyable"
    return "unknown", "No verified actionable ticket control"


def make_browser():
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
    except ImportError as exc:
        raise RuntimeError("Selenium missing; install requirements.txt") from exc
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--window-size=1365,900")
    opts.add_argument("--lang=zh-TW")
    opts.add_argument("--disable-notifications")
    browser = webdriver.Chrome(options=opts)
    browser.set_page_load_timeout(25)
    return browser


def browser_snapshot(browser, event: dict, rule: dict | None, screenshot_path: Path | None = None) -> dict:
    from selenium.webdriver.common.by import By
    from selenium.common.exceptions import TimeoutException, WebDriverException
    snap = {"date": event["date"], "url": event["url"], "ok": False, "actions": [], "verified_matches": [], "body_text": ""}
    try:
        browser.get(event["url"])
        time.sleep(4)  # Give client rendering time; no refresh loop.
        snap["title"] = browser.title
        snap["landed_url"] = browser.current_url
        if not browser.current_url.startswith("https://ticketplus.com.tw/"):
            snap["blocked"] = True
        snap["body_text"] = browser.find_element(By.TAG_NAME, "body").text[:13000]
        snap["actions"] = browser.execute_script("""
          const nodes = [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')];
          return nodes.slice(0,120).map(e => ({
            tag: e.tagName.toLowerCase(),
            text: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0,140),
            enabled: !e.disabled && e.getAttribute('aria-disabled') !== 'true',
            visible: !!e.getClientRects().length,
            class_name: String(e.className || '').slice(0,150),
            context: (e.closest('li,tr,article,[class*=ticket],[class*=price]') || e.parentElement || e).innerText.slice(0,230)
          }));
        """) or []
        if rule and rule.get("button_css"):
            elements = browser.find_elements(By.CSS_SELECTOR, rule["button_css"])
            for element in elements[:50]:
                try:
                    ancestor = element.find_element(By.XPATH, "./ancestor::*[self::tr or self::li or self::article][1]")
                    context_text = ancestor.text
                except Exception:
                    context_text = element.find_element(By.XPATH, "./parent::*").text
                snap["verified_matches"].append({
                    "text": element.text or element.get_attribute("aria-label") or "",
                    "enabled": element.is_enabled(), "visible": element.is_displayed(),
                    "context": context_text[:700]
                })
        snap["ok"] = True
        if screenshot_path:
            browser.save_screenshot(str(screenshot_path))
    except (TimeoutException, WebDriverException) as exc:
        snap["error"] = type(exc).__name__ + ": " + str(exc)[:150]
    return snap


def send_telegram(token: str, chat_id: str, label: str, url: str) -> bool:
    payload = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": f"🎟️ Ticket Plus 偵測到可購買票券！\n場次：{label}\n立即確認：{url}\n\n票況可能隨時變動，並非保留票券。",
        "disable_web_page_preview": "true",
    }).encode()
    try:
        req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=payload, method="POST")
        with urllib.request.urlopen(req, timeout=12) as res:
            reply = json.loads(res.read().decode("utf-8"))
            return bool(reply.get("ok"))
    except Exception as exc:
        print(f"Telegram delivery failed ({type(exc).__name__}); retry on next cycle", file=sys.stderr)
        return False


def process_status(prev: str, status: str, can_alert: bool, delivered: bool) -> str:
    if status == "sold_out":
        return "sold_out"
    if status == "available" and can_alert and (prev == "available" or delivered):
        return "available"
    return prev


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["probe", "monitor"], default="probe")
    args = parser.parse_args()
    events = load_json(ROOT / "config/events.json", [])
    rules = load_json(ROOT / "config/verified_rules.json", {})
    state_path = ROOT / "state/state.json"
    state = load_json(state_path, {"statuses": {}, "last_heartbeat_date": None})
    now = datetime.now(TZ)
    print(f"Mode={args.mode}; local time={now.isoformat()}; events={len(events)}")
    if is_expired(now):
        print("Monitoring period ended 2026-12-20 Asia/Taipei. Skipping checks.")
        return 0
    if args.mode == "monitor":
        missing = [name for name in ("MONITOR_ENABLED", "SITE_VERIFIED") if os.getenv(name) != "true"]
        if missing:
            print("Disabled pending live-site verification: " + ", ".join(missing))
            return 0
        if not rules or not all(e["date"] in rules for e in events):
            print("Missing independently verified selectors; refusing to alert.")
            return 1
        if not os.getenv("TELEGRAM_BOT_TOKEN") or not os.getenv("TELEGRAM_CHAT_ID"):
            print("Telegram secrets not configured. Monitoring disabled.")
            return 1
    out = ROOT / "diagnostics"
    if args.mode == "probe":
        out.mkdir(exist_ok=True)
    report = []
    browser = None
    try:
        browser = make_browser()
        for event in events:
            if args.mode == "monitor" and date.fromisoformat(event["date"]) < now.date():
                continue
            screenshot = out / ("probe-" + event["date"] + ".png") if args.mode == "probe" else None
            snapshot = browser_snapshot(browser, event, rules.get(event["date"]), screenshot)
            status, reason = classify(snapshot, rules.get(event["date"]))
            print(f"{event['label']}: {status} ({reason}); actions={len(snapshot.get('actions',[]))}")
            report.append({**snapshot, "status": status, "reason": reason})
            if args.mode == "monitor":
                old = state["statuses"].get(event["date"], "unknown")
                delivered = False
                if status == "available" and old != "available":
                    delivered = send_telegram(os.environ["TELEGRAM_BOT_TOKEN"], os.environ["TELEGRAM_CHAT_ID"], event["label"], event["url"])
                state["statuses"][event["date"]] = process_status(old, status, True, delivered)
    except Exception as exc:
        print(f"Failed safely, no availability alert: {type(exc).__name__}: {str(exc)[:240]}", file=sys.stderr)
        return 1
    finally:
        if browser:
            browser.quit()
    if args.mode == "probe":
        (out / "probe.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Probe created; NO alerts sent, state unchanged.")
    else:
        state["last_heartbeat_date"] = now.date().isoformat()
        state_path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("State updated; workflow commits only on change.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
