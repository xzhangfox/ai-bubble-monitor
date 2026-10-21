"""The filing reader: visible text only, the passages sent, and no figure
kept unless the filing says it in so many words."""

import json
import unittest
from unittest import mock

from ml import filings_llm as F

FILING = """<html><body>
<div style="display:none"><ix:header><div>hidden 999 billion</div></ix:header></div>
<p>Item 2. Management's Discussion</p>
<div><span>As of June&#160;30, 2025, we have additional operating and finance leases, primarily for datacenters, that have not yet commenced of $62.4&#160;billion.</span></div>
<p>Some unrelated text about revenue growth of 12%.</p>
<table><tr><td>Purchase commitments</td><td>$</td><td>78,300</td></tr></table>
<p>We also have purchase commitments of $78.3 billion, primarily for datacenter infrastructure and servers, as of June 30, 2025.</p>
<br/>
</body></html>"""

META = {"ticker": "MSFT", "cik": 789019, "form": "10-K", "accession": "0000950170-25-100235", "filed": "2025-07-30", "reportDate": "2025-06-30", "url": "https://www.sec.gov/x.htm"}


class Text(unittest.TestCase):
    def test_visible_text_only(self):
        t = F.html_to_text(FILING)
        self.assertNotIn("999", t)
        self.assertIn("not yet commenced of $62.4 billion", t)

    def test_passages_around_commitments(self):
        ps = F.passages(F.html_to_text(FILING), width=200)
        self.assertTrue(ps)
        self.assertTrue(any("$62.4 billion" in p for p in ps))
        self.assertFalse(any("999" in p for p in ps))


class Checks(unittest.TestCase):
    src = F.normalize(F.html_to_text(FILING))

    def item(self, **kw):
        base = {"kind": "leases_not_commenced", "amountText": "$62.4 billion", "asOf": "2025-06-30", "whatFor": "datacenters", "quote": "As of June 30, 2025, we have additional operating and finance leases, primarily for datacenters, that have not yet commenced of $62.4 billion."}
        return {**base, **kw}

    def test_kept(self):
        kept, why = F.verify(self.item(), self.src, "2025-06-30")
        self.assertEqual(why, "")
        self.assertEqual(kept["amountBn"], 62.4)

    def test_quote_must_be_in_the_filing(self):
        kept, why = F.verify(self.item(quote="As of June 30, 2025, we have leases that have not yet commenced of $72.4 billion."), self.src, "2025-06-30")
        self.assertIsNone(kept)
        self.assertEqual(why, "quote not in the filing")

    def test_amount_must_be_in_the_quote(self):
        kept, why = F.verify(self.item(amountText="$64.2 billion"), self.src, "2025-06-30")
        self.assertIsNone(kept)
        self.assertEqual(why, "amount not in the quote")

    def test_kind_and_date(self):
        self.assertEqual(F.verify(self.item(kind="debt"), self.src, "2025-06-30")[1], "unknown kind 'debt'")
        kept, _ = F.verify(self.item(asOf="June 30"), self.src, "2025-06-30")
        self.assertEqual(kept["asOf"], "2025-06-30")

    def test_amounts(self):
        self.assertEqual(F.parse_amount("$7,250 million"), 7.25e9)
        self.assertEqual(F.parse_amount("$1.2 trillion"), 1.2e12)
        self.assertEqual(F.parse_amount("$ 62.4 billion"), 62.4e9)
        self.assertIsNone(F.parse_amount("62.4"))


class Reading(unittest.TestCase):
    def test_read_filing_keeps_checked_items_only(self):
        reply = {
            "items": [
                {"kind": "leases_not_commenced", "amountText": "$62.4 billion", "asOf": "2025-06-30", "whatFor": "datacenters", "quote": "As of June 30, 2025, we have additional operating and finance leases, primarily for datacenters, that have not yet commenced of $62.4 billion."},
                {"kind": "purchase_commitments", "amountText": "$78.3 billion", "asOf": "2025-06-30", "whatFor": "datacenter infrastructure", "quote": "We also have purchase commitments of $78.3 billion, primarily for datacenter infrastructure and servers, as of June 30, 2025."},
                {"kind": "purchase_commitments", "amountText": "$90 billion", "quote": "We also have purchase commitments of $90 billion for servers."},
            ]
        }
        seen = {}
        rec = F.read_filing(META, get=lambda url: FILING.encode(), ask=lambda prompt, schema: seen.setdefault("p", prompt) and reply)
        self.assertEqual([i["amountBn"] for i in rec["items"]], [62.4, 78.3])
        self.assertEqual(rec["rejected"], [{"why": "quote not in the filing", "amountText": "$90 billion"}])
        self.assertIn("Microsoft's 10-K", seen["p"])
        self.assertIn("character for character", seen["p"])

    def test_summary_and_year_ago(self):
        def rec(acc, report, leases, purchases):
            return {**META, "accession": acc, "reportDate": report, "items": [{"kind": "leases_not_commenced", "amountBn": leases}, {"kind": "purchase_commitments", "amountBn": purchases}], "rejected": []}

        filings = {
            "a": rec("a", "2024-06-30", 100.0, 20.0),
            "b": rec("b", "2024-12-31", 150.0, 25.0),
            "c": rec("c", "2025-06-30", 200.0, 40.0),
        }
        s = F.summarize(filings)
        (c,) = s["companies"]
        self.assertEqual(c["reportDate"], "2025-06-30")
        self.assertEqual(c["yearAgo"]["reportDate"], "2024-06-30")
        self.assertEqual(s["comparedNowBn"], 240.0)
        self.assertEqual(s["change"], 1.0)
        self.assertEqual(s["checked"], {"filings": 3, "kept": 6, "dropped": 0})

    def test_run_reads_each_filing_once(self):
        def sub(cik):
            return {"filings": {"recent": {"form": ["10-Q", "8-K", "10-K"], "accessionNumber": [f"{cik}-25-1", f"{cik}-25-2", f"{cik}-25-3"], "filingDate": ["2025-10-30", "2025-10-01", "2025-07-30"], "reportDate": ["2025-09-30", "2025-10-01", "2025-06-30"], "primaryDocument": ["q.htm", "k8.htm", "k.htm"]}}}

        calls = {"ask": 0}

        def get(url):
            if "submissions" in url:
                return json.dumps(sub(int(url.split("CIK")[1][:10]))).encode()
            return FILING.encode()

        def ask(prompt, schema):
            calls["ask"] += 1
            return {"items": []}

        saved = {"filings": {"789019-25-3": {**META, "accession": "789019-25-3", "items": [], "rejected": []}, "old": {**META, "accession": "old", "items": [], "rejected": []}}}
        with mock.patch.object(F, "read_json", return_value=saved):
            out = F.run(get=get, ask=ask, pause=0)
        self.assertEqual(calls["ask"], 9)  # a 10-Q and a 10-K each, less Microsoft's saved 10-K; never the 8-Ks
        self.assertEqual(len(out["filings"]), 10)  # and filings no longer among the latest are let go
        self.assertNotIn("old", out["filings"])

if __name__ == "__main__":
    unittest.main()
