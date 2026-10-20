import unittest
from src.dual_layer_engine import advance, mark_delivered, notification_text

EVENTS=[
 {"date":"2026-12-12","label":"12/12（六）","url":"https://ticketplus.com.tw/order/a/one"},
 {"date":"2026-12-19","label":"12/19（六）","url":"https://ticketplus.com.tw/order/a/two"},
]
def obs(date="2026-12-12",activity=None,zones=None,verified=True):
    row={}
    if activity is not None: row["activity"]={"status":activity,"verified":verified}
    if zones is not None: row["zones"]={"status":zones,"verified":verified}
    return {date:row}

class DualLayerEngineTests(unittest.TestCase):
 def test_initial_positive_alert(self):
    s,alerts=advance(EVENTS,obs(activity="available"),{},{"activity"})
    self.assertEqual([x["date"] for x in alerts],["2026-12-12"])
    self.assertEqual(s["sessions"]["2026-12-12"]["sources"]["activity"],"available")
 def test_unknown_or_untrusted_cannot_alert(self):
    for trust,verified,status in [(set(),True,"available"),({"activity"},False,"available"),({"activity"},True,"unknown")]:
        _,alerts=advance(EVENTS,obs(activity=status,verified=verified),{},trust)
        self.assertEqual(alerts,[])
 def test_loading_after_sale_not_rearm(self):
    s,alerts=advance(EVENTS,obs(activity="available"),{},{"activity"})
    mark_delivered(s,alerts[0]["date"])
    s,alerts=advance(EVENTS,obs(activity="unknown"),s,{"activity"})
    self.assertEqual(alerts,[])
    self.assertTrue(s["sessions"]["2026-12-12"]["notified"])
 def test_same_signal_not_repeated(self):
    s,alerts=advance(EVENTS,obs(activity="available"),{},{"activity"})
    mark_delivered(s,alerts[0]["date"])
    s,alerts=advance(EVENTS,obs(activity="available"),s,{"activity"})
    self.assertEqual(alerts,[])
 def test_sold_out_then_available_resends(self):
    s,alerts=advance(EVENTS,obs(activity="available"),{},{"activity"})
    mark_delivered(s,alerts[0]["date"])
    s,_=advance(EVENTS,obs(activity="sold_out"),s,{"activity"})
    self.assertFalse(s["sessions"]["2026-12-12"]["notified"])
    s,alerts=advance(EVENTS,obs(activity="available"),s,{"activity"})
    self.assertEqual(len(alerts),1)
 def test_two_sources_one_alert(self):
    _,alerts=advance(EVENTS,obs(activity="available",zones="available"),{},{"activity","zones"})
    self.assertEqual(len(alerts),1)
    self.assertEqual(set(alerts[0]["sources"]),{"activity","zones"})
 def test_second_source_does_not_duplicate(self):
    s,alerts=advance(EVENTS,obs(activity="available",zones="sold_out"),{},{"activity","zones"})
    mark_delivered(s,alerts[0]["date"])
    s,alerts=advance(EVENTS,obs(activity="unknown",zones="available"),s,{"activity","zones"})
    self.assertEqual(alerts,[])
 def test_one_source_unknown_keeps_other_known_available(self):
    s,alerts=advance(EVENTS,obs(activity="sold_out",zones="available"),{},{"activity","zones"})
    mark_delivered(s,alerts[0]["date"])
    s,alerts=advance(EVENTS,obs(activity="unknown",zones="unknown"),s,{"activity","zones"})
    self.assertEqual(alerts,[])
    self.assertEqual(s["sessions"]["2026-12-12"]["sources"]["zones"],"available")
 def test_failed_delivery_retries_only_on_fresh_evidence(self):
    s,alerts=advance(EVENTS,obs(activity="available"),{},{"activity"})
    self.assertEqual(len(alerts),1)
    s,alerts=advance(EVENTS,obs(activity="unknown"),s,{"activity"})
    self.assertEqual(alerts,[])
    s,alerts=advance(EVENTS,obs(activity="available"),s,{"activity"})
    self.assertEqual(len(alerts),1)
 def test_date_isolated(self):
    s,alerts=advance(EVENTS,obs(date="2026-12-19",activity="available"),{},{"activity"})
    self.assertEqual(alerts[0]["url"],"https://ticketplus.com.tw/order/a/two")
    self.assertFalse(s["sessions"]["2026-12-12"]["notified"])
 def test_no_mutation_of_previous_state(self):
    prior={"sessions":{"2026-12-12":{"sources":{"activity":"sold_out"},"notified":False}}}
    s,_=advance(EVENTS,obs(activity="available"),prior,{"activity"})
    self.assertEqual(prior["sessions"]["2026-12-12"]["sources"]["activity"],"sold_out")
    self.assertEqual(s["sessions"]["2026-12-12"]["sources"]["activity"],"available")
 def test_message_labels_and_ticket_zone(self):
    a={"date":"2026-12-19","label":"12/19（六）","url":"https://ticketplus.com.tw/order/a/two",
       "sources":["zones"],"detail":{"zone":"黃2B NT$4,800","remaining":2}}
    msg=notification_text(a,"2026-10-20 17:30")
    self.assertIn("12/19（六）",msg)
    self.assertIn("剩餘：2",msg)
    self.assertIn("https://ticketplus.com.tw/order/a/two",msg)
 def test_pending_state_notified_only_after_ack(self):
    s,alerts=advance(EVENTS,obs(activity="available"),{},{"activity"})
    self.assertFalse(s["sessions"][alerts[0]["date"]]["notified"])
    mark_delivered(s,alerts[0]["date"])
    self.assertTrue(s["sessions"][alerts[0]["date"]]["notified"])

if __name__=="__main__": unittest.main()
