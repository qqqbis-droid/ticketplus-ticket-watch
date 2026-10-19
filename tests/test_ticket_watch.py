import unittest
from datetime import datetime
from zoneinfo import ZoneInfo
from src.ticket_watch import classify, process_status, is_expired

RULE = {"button_css": ".buy", "button_text_regex": "立即購票|購買", "context_text_regex": r"票種|NT\$|票價"}

class TicketWatchTests(unittest.TestCase):
    def test_unknown_when_unverified(self):
        s = {"ok": True, "body_text": "選擇場次", "actions": [{"text": "立即購票", "enabled": True}], "verified_matches": []}
        self.assertEqual(classify(s, None)[0], "candidate")
    def test_verified_button_works(self):
        s = {"ok": True, "body_text": "選擇場次", "actions": [], "verified_matches": [{"visible": True, "enabled": True, "text": "立即購票", "context": "票種 NT$1800"}]}
        self.assertEqual(classify(s, RULE)[0], "available")
    def test_disabled_or_soldout_context_does_not_fire(self):
        for text, enabled in [("票種 NT$1800", False), ("票種 NT$1800 已售完", True)]:
            s = {"ok": True, "body_text": "", "actions": [], "verified_matches": [{"visible": True, "enabled": enabled, "text": "立即購票", "context": text}]}
            self.assertNotEqual(classify(s, RULE)[0], "available")
    def test_captcha_and_errors_never_available(self):
        s = {"ok": True, "body_text": "請通過 captcha", "verified_matches": [{"visible": True, "enabled": True, "text": "立即購票", "context": "票價 NT$500"}]}
        self.assertEqual(classify(s, RULE)[0], "unknown")
        s["ok"] = False
        self.assertEqual(classify(s, RULE)[0], "unknown")
    def test_login_redirect_is_not_a_ticket(self):
        s = {"ok": True, "url": "https://ticketplus.com.tw/order/event/session",
             "landed_url": "https://ticketplus.com.tw/activity/event",
             "body_text": "會員登入 密碼 立即購買",
             "actions": [{"text": "立即購買", "enabled": True}],
             "verified_matches": [{"visible": True, "enabled": True, "text": "立即購買", "context": "票價 NT$1000"}]}
        self.assertEqual(classify(s, RULE)[0], "login_required")

    def test_sold_out_exact_only(self):
        self.assertEqual(classify({"ok": True, "body_text": "本場次已售完"}, None)[0], "sold_out")
        self.assertEqual(classify({"ok": True, "body_text": "一般票已售完，VIP仍有票"}, None)[0], "unknown")
    def test_persist_only_after_notification(self):
        self.assertEqual(process_status("sold_out", "available", True, False), "sold_out")
        self.assertEqual(process_status("sold_out", "available", True, True), "available")
        self.assertEqual(process_status("available", "unknown", True, False), "available")
        self.assertEqual(process_status("available", "sold_out", True, False), "sold_out")
    def test_end_date_taipei(self):
        tz = ZoneInfo("Asia/Taipei")
        self.assertFalse(is_expired(datetime(2026, 12, 20, 23, 59, tzinfo=tz)))
        self.assertTrue(is_expired(datetime(2026, 12, 21, 0, 0, tzinfo=tz)))

if __name__ == "__main__":
    unittest.main()
