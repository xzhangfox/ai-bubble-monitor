"""The SEC capex series: quarters out of year-to-date figures, trailing years,
first-reported values, and nothing counted before it was filed."""

import unittest
from datetime import date

from ml.sec_capex import aggregate, build, company_series, duration_facts, quarters, trailing_year, year_ago


def row(start, end, val, filed, form="10-Q"):
    return {"start": start, "end": end, "val": val, "filed": filed, "form": form}


def facts(capex_rows, revenue_rows, capex_concept="PaymentsToAcquirePropertyPlantAndEquipment"):
    return {
        "facts": {
            "us-gaap": {
                capex_concept: {"units": {"USD": capex_rows}},
                "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": revenue_rows}},
            }
        }
    }


def calendar_company(years, capex_q, revenue_q, concept="PaymentsToAcquirePropertyPlantAndEquipment"):
    """A calendar-year filer: capex year to date (as cash-flow statements are),
    revenue per quarter; each quarter filed a month after it ends."""
    capex, revenue = [], []
    ends = ["03-31", "06-30", "09-30", "12-31"]
    starts = ["01-01", "04-01", "07-01", "10-01"]
    filed = ["04-30", "07-30", "10-30"]
    for y in years:
        ytd = 0
        for q in range(4):
            ytd += capex_q
            form = "10-K" if q == 3 else "10-Q"
            f = f"{y + 1}-02-01" if q == 3 else f"{y}-{filed[q]}"
            capex.append(row(f"{y}-01-01", f"{y}-{ends[q]}", ytd, f, form))
            revenue.append(row(f"{y}-{starts[q]}", f"{y}-{ends[q]}", revenue_q, f, form))
        revenue.append(row(f"{y}-01-01", f"{y}-12-31", revenue_q * 4, f"{y + 1}-02-01", "10-K"))
    return facts(capex, revenue, concept)


class QuarterMath(unittest.TestCase):
    def test_quarters_from_year_to_date(self):
        f = facts(
            [
                row("2024-01-01", "2024-03-31", 10, "2024-04-30"),
                row("2024-01-01", "2024-06-30", 25, "2024-07-30"),
                row("2024-01-01", "2024-09-30", 45, "2024-10-30"),
                row("2024-01-01", "2024-12-31", 70, "2025-02-01", "10-K"),
            ],
            [],
        )
        qs = quarters(duration_facts(f, ["PaymentsToAcquirePropertyPlantAndEquipment"]))
        self.assertEqual([q.val for q in qs], [10, 15, 20, 25])
        self.assertEqual(qs[-1].known, date(2025, 2, 1))  # Q4 needs the 10-K
        ttm = trailing_year(qs)
        self.assertEqual(len(ttm), 1)
        self.assertEqual(ttm[0].val, 70)

    def test_first_report_wins_over_restatement(self):
        f = facts(
            [
                row("2024-01-01", "2024-03-31", 10, "2024-04-30"),
                row("2024-01-01", "2024-03-31", 12, "2025-04-30"),  # recast a year later
            ],
            [],
        )
        (q,) = quarters(duration_facts(f, ["PaymentsToAcquirePropertyPlantAndEquipment"]))
        self.assertEqual((q.val, q.known), (10, date(2024, 4, 30)))

    def test_first_report_wins_across_tags(self):
        # filed as "Revenues" at the time; restated two years later under the ASC 606 tag
        f = {
            "facts": {
                "us-gaap": {
                    "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": [row("2017-01-01", "2017-03-31", 101, "2019-04-30")]}},
                    "Revenues": {"units": {"USD": [row("2017-01-01", "2017-03-31", 100, "2017-04-28")]}},
                }
            }
        }
        (fact,) = duration_facts(f, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"])
        self.assertEqual((fact.val, fact.filed), (100, date(2017, 4, 28)))

    def test_missing_quarter_breaks_the_trailing_year(self):
        f = facts(
            [
                row("2024-01-01", "2024-03-31", 10, "2024-04-30"),
                row("2024-01-01", "2024-09-30", 45, "2024-10-30"),  # no half-year figure
                row("2024-01-01", "2024-12-31", 70, "2025-02-01", "10-K"),
            ],
            [],
        )
        qs = quarters(duration_facts(f, ["PaymentsToAcquirePropertyPlantAndEquipment"]))
        self.assertEqual([q.end.isoformat() for q in qs], ["2024-03-31", "2024-12-31"])
        self.assertEqual(trailing_year(qs), [])

    def test_trailing_year_from_year_to_date_when_a_quarter_is_missing(self):
        f = facts(
            [
                row("2023-01-01", "2023-09-30", 30, "2023-10-30"),
                row("2023-01-01", "2023-12-31", 40, "2024-02-01", "10-K"),
                row("2024-01-01", "2024-03-31", 12, "2024-04-30"),
                row("2024-01-01", "2024-09-30", 45, "2024-10-30"),  # no half-year figure
            ],
            [],
        )
        from ml.sec_capex import trailing_points

        pts = trailing_points(duration_facts(f, ["PaymentsToAcquirePropertyPlantAndEquipment"]))
        p = pts[date(2024, 9, 30)]
        self.assertEqual((p.val, p.known), (45 + 40 - 30, date(2024, 10, 30)))
        self.assertEqual(pts[date(2023, 12, 31)].val, 40)

    def test_off_calendar_fiscal_year(self):
        # Oracle-style: fiscal year to May 31
        ends = ["2024-08-31", "2024-11-30", "2025-02-28", "2025-05-31"]
        f = facts([row("2024-06-01", e, 5 * (i + 1), "2025-06-20") for i, e in enumerate(ends)], [])
        qs = quarters(duration_facts(f, ["PaymentsToAcquirePropertyPlantAndEquipment"]))
        self.assertEqual([q.val for q in qs], [5, 5, 5, 5])
        self.assertEqual(trailing_year(qs)[0].val, 20)


class Sector(unittest.TestCase):
    def test_build_and_no_lookahead(self):
        years = range(2016, 2026)
        comps = {t: calendar_company(years, capex_q=c, revenue_q=100) for t, c in [("MSFT", 10), ("GOOGL", 12), ("AMZN", 14), ("META", 16), ("ORCL", 8)]}
        comps["AMZN"] = calendar_company(years, capex_q=14, revenue_q=100, concept="PaymentsToAcquireProductiveAssets")
        out = build(comps)
        self.assertAlmostEqual(out["latest"]["intensity"], (10 + 12 + 14 + 16 + 8) / 500, places=5)
        self.assertEqual(set(out["latest"]["members"]), {"MSFT", "GOOGL", "AMZN", "META", "ORCL"})
        # Nothing is dated before the filing that made it public.
        for p in out["series"]:
            for m in p["members"].values():
                self.assertLess(m["periodEnd"], p["date"])
        self.assertIsNotNone(out["yearAgo"])
        self.assertLessEqual(out["yearAgo"]["date"], "2025-02-01")

    def test_waits_for_every_company(self):
        a = [{"periodEnd": "2024-03-31", "known": "2024-04-25", "capex": 10.0, "revenue": 100.0}]
        b = [{"periodEnd": "2024-03-31", "known": "2024-05-01", "capex": 30.0, "revenue": 100.0}]
        out = aggregate({"A": a, "B": b})
        self.assertEqual([p["date"] for p in out], ["2024-05-01"])
        self.assertAlmostEqual(out[0]["intensity"], 0.2)

    def test_stale_member_is_not_mixed_in(self):
        a = [{"periodEnd": "2023-06-30", "known": "2023-07-25", "capex": 10.0, "revenue": 100.0}]
        b = [{"periodEnd": "2024-03-31", "known": "2024-05-01", "capex": 30.0, "revenue": 100.0}]
        self.assertEqual(aggregate({"A": a, "B": b}), [])

    def test_company_series_needs_both(self):
        f = calendar_company(range(2020, 2023), capex_q=10, revenue_q=100)
        rows = company_series(f, "MSFT")
        self.assertEqual(rows[-1], {"periodEnd": "2022-12-31", "known": "2023-02-01", "capex": 40.0, "revenue": 400.0})

    def test_year_ago(self):
        s = [{"date": "2024-01-10"}, {"date": "2024-06-01"}, {"date": "2025-01-05"}, {"date": "2025-06-02"}]
        self.assertEqual(year_ago(s)["date"], "2024-06-01")


if __name__ == "__main__":
    unittest.main()
