"""Dalio's fifth hallmark, which the market data couldn't measure: buyers
making unusually extended forward purchases. For AI that's the hyperscalers'
data-centre build-out, so this measures their capital spending against their
revenue — trailing twelve months, summed over Microsoft, Alphabet, Amazon,
Meta and Oracle — from the numbers they file with the SEC (XBRL company facts).

No lookahead: a quarter counts from the day after the filing that reported
it, and a figure is taken as first reported (later restatements don't reach
back). Writes data/ai-bubble/sec-capex.json, which the Node script turns into
the eighth indicator.

    python -m ml.sec_capex
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from ml.common import annotate, http_get, read_json, write_json

COMPANIES = {
    "MSFT": 789019,
    "GOOGL": 1652044,
    "AMZN": 1018724,
    "META": 1326801,
    "ORCL": 1341439,
}

# What each files its capital spending and revenue under. Capex is the one
# cash-flow line, "purchases of property and equipment" — which Amazon moved
# from the PP&E tag to the productive-assets tag around 2017; revenue moved
# between tags with ASC 606, and any of these is total revenue.
CAPEX_CONCEPTS = {
    "AMZN": ["PaymentsToAcquireProductiveAssets", "PaymentsToAcquirePropertyPlantAndEquipment"],
}
DEFAULT_CAPEX = ["PaymentsToAcquirePropertyPlantAndEquipment"]
REVENUE_CONCEPTS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
]
FORMS = {"10-Q", "10-K", "10-Q/A", "10-K/A"}


@dataclass(frozen=True)
class Fact:
    start: date
    end: date
    val: float
    filed: date
    form: str

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1


@dataclass(frozen=True)
class Point:
    """A value for a period, and the day it became public."""

    end: date
    val: float
    known: date


def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


def duration_facts(companyfacts: dict, concepts: list[str]) -> list[Fact]:
    """Every duration fact for these concepts, one per period: as first
    reported, whichever tag it was filed under then (a later filing's
    comparative under a newer tag would date it a year or two late); the
    concepts' order only breaks a tie on the same day."""
    by_period: dict[tuple[date, date], Fact] = {}
    gaap = companyfacts.get("facts", {}).get("us-gaap", {})
    for concept in concepts:
        for row in gaap.get(concept, {}).get("units", {}).get("USD", []):
            if "start" not in row or row.get("form") not in FORMS:
                continue
            f = Fact(_d(row["start"]), _d(row["end"]), float(row["val"]), _d(row["filed"]), row["form"])
            key = (f.start, f.end)
            if key not in by_period or f.filed < by_period[key].filed:
                by_period[key] = f
    return sorted(by_period.values(), key=lambda f: (f.end, f.start))


def quarters(facts: list[Fact]) -> list[Point]:
    """Three-month values: reported directly, or the difference between two
    year-to-date figures (cash-flow items are only reported year to date)."""
    out: dict[date, Point] = {}
    for f in facts:
        if 80 <= f.days <= 100:
            out[f.end] = Point(f.end, f.val, f.filed)
    by_start: dict[date, list[Fact]] = {}
    for f in facts:
        if 80 <= f.days <= 380:
            by_start.setdefault(f.start, []).append(f)
    for start, group in by_start.items():
        group.sort(key=lambda f: f.end)
        prev_end, prev_val, prev_filed = start - timedelta(days=1), 0.0, date.min
        for f in group:
            span = (f.end - prev_end).days
            if 80 <= span <= 100 and f.end not in out:
                out[f.end] = Point(f.end, f.val - prev_val, max(f.filed, prev_filed))
            prev_end, prev_val, prev_filed = f.end, f.val, f.filed
    return sorted(out.values(), key=lambda p: p.end)


def trailing_year(qs: list[Point]) -> list[Point]:
    """Sum of four consecutive quarters, known once the last of them is."""
    out: list[Point] = []
    for i in range(3, len(qs)):
        window = qs[i - 3 : i + 1]
        gaps = [(b.end - a.end).days for a, b in zip(window, window[1:])]
        if all(80 <= g <= 100 for g in gaps):
            out.append(Point(window[-1].end, sum(p.val for p in window), max(p.known for p in window)))
    return out


def company_series(companyfacts: dict, ticker: str) -> list[dict]:
    """Trailing-year capex and revenue for one company, per quarter end."""
    capex = {p.end: p for p in trailing_year(quarters(duration_facts(companyfacts, CAPEX_CONCEPTS.get(ticker, DEFAULT_CAPEX))))}
    revenue = {p.end: p for p in trailing_year(quarters(duration_facts(companyfacts, REVENUE_CONCEPTS)))}
    rows = []
    for end in sorted(set(capex) & set(revenue)):
        c, r = capex[end], revenue[end]
        if r.val <= 0 or c.val < 0:
            continue
        rows.append({"periodEnd": end.isoformat(), "known": max(c.known, r.known).isoformat(), "capex": c.val, "revenue": r.val})
    return rows


def aggregate(per_company: dict[str, list[dict]], max_spread_days: int = 120) -> list[dict]:
    """The sector's capex-to-revenue ratio each time a company's new quarter
    becomes public, from every company's latest known trailing year."""
    events = sorted(
        ((row["known"], ticker, row) for ticker, rows in per_company.items() for row in rows),
        key=lambda e: (e[0], e[1]),
    )
    latest: dict[str, dict] = {}
    out: list[dict] = []
    i = 0
    while i < len(events):
        day = events[i][0]
        while i < len(events) and events[i][0] == day:
            _, ticker, row = events[i]
            if ticker not in latest or row["periodEnd"] >= latest[ticker]["periodEnd"]:
                latest[ticker] = row
            i += 1
        if len(latest) < len(per_company):
            continue
        ends = [_d(r["periodEnd"]) for r in latest.values()]
        if (max(ends) - min(ends)).days > max_spread_days:
            continue
        capex = sum(r["capex"] for r in latest.values())
        revenue = sum(r["revenue"] for r in latest.values())
        out.append(
            {
                "date": day,
                "intensity": round(capex / revenue, 5),
                "capexTtmBn": round(capex / 1e9, 1),
                "revenueTtmBn": round(revenue / 1e9, 1),
                "members": {
                    t: {"periodEnd": r["periodEnd"], "capexTtmBn": round(r["capex"] / 1e9, 1), "revenueTtmBn": round(r["revenue"] / 1e9, 1)}
                    for t, r in sorted(latest.items())
                },
            }
        )
    return out


def year_ago(series: list[dict]) -> dict | None:
    """The reading a year before the latest one (the last known by then)."""
    if not series:
        return None
    cutoff = (_d(series[-1]["date"]) - timedelta(days=365)).isoformat()
    before = [p for p in series if p["date"] <= cutoff]
    return before[-1] if before else None


def build(facts_by_ticker: dict[str, dict]) -> dict:
    per_company = {t: company_series(facts_by_ticker[t], t) for t in COMPANIES}
    missing = [t for t, rows in per_company.items() if not rows]
    if missing:
        raise RuntimeError(f"No capex/revenue series for {', '.join(missing)} — SEC data may be degraded")
    series = aggregate(per_company)
    if len(series) < 20:
        raise RuntimeError(f"Only {len(series)} aggregate readings — SEC data may be degraded")
    prior = year_ago(series)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "companies": list(COMPANIES),
        "definition": "Trailing-twelve-month capital expenditures (purchases of property and equipment) divided by trailing-twelve-month revenue, summed over the companies, as of each filing date.",
        "source": "SEC EDGAR XBRL company facts (10-Q and 10-K filings)",
        "latest": series[-1],
        "yearAgo": prior,
        "series": series,
    }


def fetch_facts(cik: int) -> dict:
    return json.loads(http_get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"))


def main() -> int:
    try:
        facts = {}
        for t, cik in COMPANIES.items():
            facts[t] = fetch_facts(cik)
            time.sleep(0.2)
        for t in COMPANIES:
            rows = company_series(facts[t], t)
            last = rows[-1] if rows else None
            annotate(
                "notice",
                f"SEC {t}",
                f"{len(rows)} trailing years; latest to {last['periodEnd']}: capex {last['capex'] / 1e9:.1f}bn, revenue {last['revenue'] / 1e9:.1f}bn" if last else "no capex/revenue series",
            )
        out = build(facts)
        old = read_json("sec-capex.json")
        if old and old.get("latest", {}).get("date", "") > out["latest"]["date"]:
            raise RuntimeError("SEC data is older than what's saved — keeping the saved file")
    except Exception as err:
        annotate("error", "SEC capex", str(err))
        return 1
    write_json("sec-capex.json", out)
    last = out["latest"]
    annotate("notice", "SEC capex", f"{last['intensity']:.1%} of revenue as of {last['date']} ({last['capexTtmBn']}bn / {last['revenueTtmBn']}bn), {len(out['series'])} readings")
    return 0

if __name__ == "__main__":
    sys.exit(main())
