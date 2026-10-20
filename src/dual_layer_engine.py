"""Pure, conservative two-layer ticket alert state machine.

This module performs no network access. A source is trusted only after separately
verified live-site parsing. Unknown/blocked observations must never trigger alerts.
"""
from __future__ import annotations

from copy import deepcopy

SOURCES = ("activity", "zones")
KNOWN = {"available", "sold_out"}


def advance(events: list[dict], observations: dict, state: dict,
            trusted_sources: set[str]) -> tuple[dict, list[dict]]:
    """Process one polling cycle; return a state copy and notifications *to attempt*.

    observations format: {YYYY-MM-DD: {activity: {"status": ...},
                                         zones: {"status": ..., "detail": ...}}}
    IMPORTANT: calling advance does NOT mean a Telegram message was delivered.
    After successful delivery, call mark_delivered on the returned state.
    """
    result = deepcopy(state) if isinstance(state, dict) else {}
    sessions = result.setdefault("sessions", {})
    due = []

    for event in events:
        date = event["date"]
        entry = sessions.setdefault(date, {"sources": {}, "notified": False})
        prior = entry.setdefault("sources", {})
        current = observations.get(date, {})
        fresh_available = []

        for source in SOURCES:
            observation = current.get(source, {})
            status = observation.get("status") if isinstance(observation, dict) else None
            # Trust configuration AND positive evidence of a clean parsed page.
            if source not in trusted_sources or not observation.get("verified", False):
                continue
            if status not in KNOWN:
                continue
            prior[source] = status
            if status == "available":
                fresh_available.append(source)

        active = any(v == "available" for v in prior.values())
        if not active:
            entry["notified"] = False  # Reset only after observed known sold-out.
        if active and fresh_available and not entry.get("notified", False):
            due.append({
                "date": date, "label": event["label"], "url": event["url"],
                "sources": fresh_available,
                "detail": current.get("zones", {}).get("detail") if "zones" in fresh_available else None,
            })
    return result, due


def mark_delivered(state: dict, date: str) -> None:
    """Mark *only* an API-confirmed Telegram delivery to prevent duplicate alerts."""
    entry = state.get("sessions", {}).get(date)
    if entry and any(v == "available" for v in entry.get("sources", {}).values()):
        entry["notified"] = True


def notification_text(alert: dict, time_text: str) -> str:
    sources = set(alert.get("sources", []))
    signal = "活動首頁藍色可購買按鈕" if sources == {"activity"} else (
        "個別場次票區可購買" if sources == {"zones"} else "活動首頁與個別票區均有可購買訊號"
    )
    pieces = [
        "🎟️ Ticket Plus 釋票訊號（請立即確認）",
        f"場次：{alert['label']}",
        f"來源：{signal}",
    ]
    detail = alert.get("detail") or {}
    if "zones" in sources and isinstance(detail, dict):
        zone = str(detail.get("zone", ""))[:60]
        count = detail.get("remaining")
        if zone:
            pieces.append(f"票區：{zone}")
        if isinstance(count, int) and count > 0:
            pieces.append(f"頁面顯示剩餘：{count} 張")
    pieces.extend([
        f"檢查時間（台北）：{time_text}",
        f"前往該場：{alert['url']}",
        "提醒：網站票況隨時變動，不代表票券已保留。",
    ])
    return "\n".join(pieces)
