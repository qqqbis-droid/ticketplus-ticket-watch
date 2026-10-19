import unittest
from src.public_activity import classify_row,classify_activity,URL
dates=["2026-12-"+d for d in ("12","13","15","18","19","20")]
def row(d,status,controls=None):return {"date":d,"status_text":status,"status_controls":controls or []}
def btn():return {"text":"立即購買","visible":True,"enabled":True,"blue":True,"blocked":False,"surrounding_text":"立即購買"}
class PublicActivityTests(unittest.TestCase):
    def test_sold(self):self.assertEqual(classify_row(row(dates[0],"銷售一空")),"sold_out")
    def test_blue_clickable(self):self.assertEqual(classify_row(row(dates[0],"立即購買",[btn()])),"available")
    def test_hidden_disabled_not_blue(self):
        for k,v in (("enabled",False),("visible",False),("blue",False),("text","會員登入")):
            b=btn();b[k]=v
            self.assertEqual(classify_row(row(dates[0],"立即購買",[b])),"unknown")
    def test_generic_buy_button_not_seen(self):
        rows=[row(d,"已售完") for d in dates]
        states,_=classify_activity({"ok":True,"landed_url":URL,"rows":rows,"header_btn":btn()},dates)
        self.assertTrue(all(x=="sold_out" for x in states.values()))
    def test_wrong_or_partial_page_unknown(self):
        for rows in ([row(d,"已售完") for d in dates[:5]],[row(d,"已售完") for d in dates]+[row(dates[0],"立即購買",[btn()])]):
            states,_=classify_activity({"ok":True,"landed_url":URL,"rows":rows},dates)
            self.assertEqual(set(states.values()),{"unknown"})
    def test_loading_invalid(self):
        states,_=classify_activity({"ok":True,"landed_url":URL,"loading":True,"rows":[row(d,"立即購買",[btn()]) for d in dates]},dates)
        self.assertEqual(set(states.values()),{"unknown"})
    def test_only_right_row_triggers(self):
        rows=[row(d,"已售完") for d in dates]
        rows[2]=row(dates[2],"立即購買",[btn()])
        states,_=classify_activity({"ok":True,"landed_url":URL,"rows":rows},dates)
        self.assertEqual(states[dates[2]],"available")
        self.assertEqual(states[dates[0]],"sold_out")
