"""Today's reading in a few sentences, English and Chinese, written by an LLM
from the day's numbers — and checked before it's published: every number in
it must be one of the day's facts (no arithmetic of its own, no invented
figures), and it may not give advice. A draft that fails gets one rewrite
with the problems named; if that fails too, nothing is published that day.

Writes data/ai-bubble/briefing.json. Needs GEMINI_API_KEY.

    python -m ml.briefing
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any, Callable

from ml.common import GEMINI_MODEL, gemini_json, read_json, write_json

SCHEMA = {
    "type": "OBJECT",
    "properties": {"en": {"type": "STRING"}, "zh": {"type": "STRING"}},
    "required": ["en", "zh"],
}
NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
ADVICE_EN = re.compile(r"\b(buy|buying|sell|selling|short the|go long|should (?:buy|sell|invest|hold))\b", re.I)
ADVICE_ZH = re.compile(r"买入|卖出|建议(?:投资|买|卖|持有)")


def pct(x: float | None) -> str | None:
    return None if x is None else f"{round(x * 100)}%"


def build_facts(latest: dict, history: dict, model: dict | None, capex: dict | None, commitments: dict | None) -> dict:
    """The day's numbers, already in the units the text will use."""
    series = [p for p in history.get("series", []) if p.get("compositeScore") is not None]
    now = latest["compositeScore"]
    week = series[-6]["compositeScore"] if len(series) > 6 else None
    month = series[-22]["compositeScore"] if len(series) > 22 else None
    inds = sorted((i for i in latest["indicators"] if i.get("score") is not None), key=lambda i: -i["score"])
    facts: dict[str, Any] = {
        "asOf": latest["asOf"],
        "compositeScore": now,
        "band": latest["category"],
        "bandsLowToHigh": ["Low", "Moderate", "Elevated", "High", "Extreme"],
        "compositeWeekAgo": week,
        "changeVsWeekAgo": None if week is None else round(now - week, 1),
        "compositeMonthAgo": month,
        "changeVsMonthAgo": None if month is None else round(now - month, 1),
        "indicatorCount": len(latest["indicators"]),
        "indicatorsHottestFirst": [{"name": i["name"], "percentileRank": round(i["score"]), "reading": i["rawFormatted"]} for i in inds],
    }
    if model:
        h = model["headline"]
        best = next(m for m in model["models"] if m["id"] == h["model"])
        facts["drawdownModel"] = {
            "question": "chance the AI basket falls 10% or more below today's close within the next 3 months (63 trading days)",
            "model": best["name"],
            "chance": pct(h["probability"]),
            "baseRate": pct(h["baseRate"]),
            "beatsBaseRateReliably": h["beatsBaseRate"],
            "backtestAuc": best["auc"],
            "similarPastDays": model["analogs"]["nearest"],
            "similarPastDaysThatFell10Pct": pct(model["analogs"]["nearestFell"]),
        }
    if capex and capex.get("latest"):
        c, y = capex["latest"], capex.get("yearAgo")
        facts["hyperscalerCapex"] = {
            "companies": "Microsoft, Alphabet, Amazon, Meta, Oracle",
            "capexShareOfRevenue": f"{c['intensity'] * 100:.1f}%",
            "capexShareOfRevenueYearAgo": f"{y['intensity'] * 100:.1f}%" if y else None,
            "capexLast12MonthsBillionUSD": c["capexTtmBn"],
            "capexLast12Months亿USD": round(c["capexTtmBn"] * 10),
        }
    s = (commitments or {}).get("summary")
    if s and s.get("companies"):
        facts["committedNotYetSpent"] = {
            "what": "leases signed but not yet begun plus purchase commitments, from the latest 10-Q/10-K filings",
            "totalBillionUSD": s["totalBn"],
            "total亿USD": round(s["totalBn"] * 10),
            "changeVsYearAgo": pct(s["change"]),
        }
    return facts


def allowed_numbers(facts: dict) -> set[float]:
    out: set[float] = set()

    def walk(v: Any) -> None:
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, (int, float)):
            out.update({float(abs(v)), float(round(abs(v))), float(round(abs(v), 1))})
        elif isinstance(v, str):
            for tok in NUMBER.findall(v):
                x = float(tok.replace(",", ""))
                out.update({x, float(round(x)), float(round(x, 1))})
        elif isinstance(v, dict):
            for k, x in v.items():
                walk(k)
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(facts)
    return out


def check(text: dict, facts: dict) -> list[str]:
    """What's wrong with a draft, or nothing."""
    problems = []
    ok = allowed_numbers(facts)
    for lang in ("en", "zh"):
        t = str(text.get(lang) or "").strip()
        if not t:
            problems.append(f"{lang}: empty")
            continue
        bad = sorted({tok for tok in NUMBER.findall(t) if float(tok.replace(",", "")) not in ok})
        if bad:
            problems.append(f"{lang}: numbers not in the facts: {', '.join(bad)}")
    if ADVICE_EN.search(str(text.get("en") or "")) or ADVICE_ZH.search(str(text.get("zh") or "")):
        problems.append("reads as investment advice")
    if len(str(text.get("en") or "").split()) > 120:
        problems.append("en: over 120 words")
    if len(str(text.get("zh") or "")) > 260:
        problems.append("zh: over 260 characters")
    return problems


def prompt_for(facts: dict) -> str:
    return f"""Write today's short briefing for the AI Bubble Monitor, a public dashboard that tracks whether AI-linked markets show the classic signs of a speculative bubble. Write it twice: in English ("en") and in Simplified Chinese ("zh"), saying the same things.

- English: 3 or 4 plain sentences, under 90 words. Chinese: the same, under 180 characters.
- Say what the composite score reads and its band, how it moved over the past week and month, which indicators run hottest and which coolest.
- Give the drawdown model's chance against the base rate. If beatsBaseRateReliably is false, say plainly that the model does not yet beat the base rate reliably.
- If hyperscaler capex or the committed-but-not-yet-spent figures are given, one sentence on them.
- Every number must be copied from the facts exactly as written: no arithmetic, no rounding of your own, no numbers that aren't there. Use Arabic digits, in Chinese too; in Chinese, give money in 亿美元 using the 亿USD figures.
- Describe; don't advise. No buy/sell language, no predictions beyond the model's stated chance.

Facts:
{json.dumps(facts, ensure_ascii=False, indent=1)}"""


def generate(facts: dict, *, ask: Callable[..., Any] = gemini_json, tries: int = 2) -> dict:
    prompt = prompt_for(facts)
    problems: list[str] = []
    for attempt in range(1, tries + 1):
        draft = ask(prompt, SCHEMA, temperature=0.3) or {}
        problems = check(draft, facts)
        if not problems:
            return {"en": draft["en"].strip(), "zh": draft["zh"].strip(), "attempts": attempt}
        prompt = prompt_for(facts) + "\n\nYour previous draft had these problems — fix them:\n- " + "\n- ".join(problems)
    return {"en": None, "zh": None, "attempts": tries, "problems": problems}


def main() -> int:
    if not os.environ.get("GEMINI_API_KEY"):
        print("GEMINI_API_KEY isn't set — no briefing today")
        return 0
    latest = read_json("latest.json")
    facts = build_facts(latest, read_json("history.json", {}), read_json("model.json"), read_json("sec-capex.json"), read_json("commitments.json"))
    if read_json("model.json") and read_json("model.json").get("asOf") != latest["asOf"]:
        facts.pop("drawdownModel", None)  # (yesterday's model run: leave it out rather than mix days)
    out = generate(facts)
    write_json(
        "briefing.json",
        {"asOf": latest["asOf"], "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "model": GEMINI_MODEL, **out, "facts": facts},
    )
    print(f"Briefing: {'published' if out['en'] else 'withheld — ' + '; '.join(out['problems'])} after {out['attempts']} attempt(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
