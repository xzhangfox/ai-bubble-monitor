"""The daily briefing's checks: numbers only from the day's facts, no advice,
one rewrite, and nothing published when it still fails."""

import unittest

from ml import briefing as B

LATEST = {
    "asOf": "2026-10-20",
    "compositeScore": 46.1,
    "category": "Elevated",
    "indicators": [
        {"name": "Forward Purchases: Hyperscaler Capex vs Revenue", "score": 100, "rawFormatted": "27.3% of revenue (TTM capex)"},
        {"name": "Volatility Complacency (VIX)", "score": 12.4, "rawFormatted": "VIX 21.4"},
        {"name": "Valuation Stretch vs 200-Day Trend", "score": 61.0, "rawFormatted": "+8.2% above 200D MA"},
    ],
}
HISTORY = {"series": [{"date": f"d{i}", "compositeScore": round(46.1 - (39 - i) * 0.1, 1)} for i in range(40)]}  # (the last day is today)
MODEL = {
    "headline": {"model": "logistic", "probability": 0.234, "baseRate": 0.27, "beatsBaseRate": False},
    "models": [{"id": "logistic", "name": "Logistic regression", "auc": 0.61}],
    "analogs": {"nearest": 50, "nearestFell": 0.32},
}
CAPEX = {"latest": {"intensity": 0.273, "capexTtmBn": 402.5}, "yearAgo": {"intensity": 0.214}}
COMMIT = {"summary": {"companies": [{}], "totalBn": 512.3, "change": 0.41}}

FACTS = B.build_facts(LATEST, HISTORY, MODEL, CAPEX, COMMIT)
GOOD = {
    "en": "The composite reads 46.1, in the Elevated band, up 2.1 points from a month ago. Hyperscaler capex is 27.3% of revenue, against 21.4% a year ago. The model puts the chance of a 10% fall within 3 months at 23%, against a 27% base rate, and does not yet beat the base rate reliably.",
    "zh": "截至2026-10-20，综合指数为46.1，处于偏高区间，较一个月前上升2.1。大厂资本开支占收入27.3%。模型估计未来3个月下跌10%以上的概率为23%，基准为27%，目前还不能稳定胜过基准。",
}


class Facts(unittest.TestCase):
    def test_changes_are_precomputed(self):
        self.assertEqual(FACTS["changeVsMonthAgo"], 2.1)
        self.assertEqual(FACTS["drawdownModel"]["chance"], "23%")
        self.assertEqual(FACTS["hyperscalerCapex"]["capexLast12Months亿USD"], 4025)
        self.assertEqual(FACTS["committedNotYetSpent"]["changeVsYearAgo"], "41%")
        self.assertEqual(FACTS["indicatorsHottestFirst"][0]["percentileRank"], 100)


class Checks(unittest.TestCase):
    def test_good_passes(self):
        self.assertEqual(B.check(GOOD, FACTS), [])

    def test_invented_number(self):
        bad = {**GOOD, "en": GOOD["en"].replace("23%", "31%")}
        self.assertEqual(B.check(bad, FACTS), ["en: numbers not in the facts: 31"])

    def test_own_arithmetic_is_caught(self):
        # 27.3 - 21.4 = 5.9: true, but not a figure it was given
        bad = {**GOOD, "zh": GOOD["zh"].replace("大厂资本开支占收入27.3%", "大厂资本开支占收入一年上升5.9个百分点")}
        self.assertEqual(B.check(bad, FACTS), ["zh: numbers not in the facts: 5.9"])

    def test_rounding_of_a_given_figure_is_fine(self):
        self.assertEqual(B.check({**GOOD, "en": GOOD["en"].replace("46.1", "46")}, FACTS), [])

    def test_advice(self):
        self.assertIn("reads as investment advice", B.check({**GOOD, "en": GOOD["en"] + " Investors should sell."}, FACTS))
        self.assertIn("reads as investment advice", B.check({**GOOD, "zh": GOOD["zh"] + "建议卖出。"}, FACTS))

    def test_empty_and_long(self):
        self.assertIn("zh: empty", B.check({**GOOD, "zh": ""}, FACTS))
        self.assertIn("en: over 120 words", B.check({**GOOD, "en": "word " * 121}, FACTS))


class Generate(unittest.TestCase):
    def test_one_rewrite_with_the_problems_named(self):
        drafts = [{**GOOD, "en": GOOD["en"].replace("23%", "31%")}, GOOD]
        prompts = []

        def ask(prompt, schema, temperature=0.0):
            prompts.append(prompt)
            return drafts[len(prompts) - 1]

        out = B.generate(FACTS, ask=ask)
        self.assertEqual(out["attempts"], 2)
        self.assertEqual(out["en"], GOOD["en"])
        self.assertIn("numbers not in the facts: 31", prompts[1])

    def test_withheld_when_it_keeps_failing(self):
        out = B.generate(FACTS, ask=lambda p, s, temperature=0.0: {**GOOD, "en": "It is 99."})
        self.assertIsNone(out["en"])
        self.assertTrue(out["problems"])

    def test_prompt_carries_the_rules(self):
        p = B.prompt_for(FACTS)
        self.assertIn("no arithmetic", p)
        self.assertIn('"beatsBaseRateReliably": false', p)


if __name__ == "__main__":
    unittest.main()
