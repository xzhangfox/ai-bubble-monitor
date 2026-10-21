"""How often the briefing writer gets it right: a few fixed days (calm,
stretched, the model beating the base rate or not, missing pieces), several
drafts each, scored by the same checks the daily job applies. Run by hand
with GEMINI_API_KEY set; it prints first-try passes, passes after the one
rewrite, and drafts withheld.

    python -m ml.eval_briefing [drafts per case]
"""

from __future__ import annotations

import copy
import sys

from ml.briefing import build_facts, check, generate
from ml.tests.test_briefing import CAPEX, COMMIT, HISTORY, LATEST, MODEL


def cases() -> dict[str, dict]:
    base = build_facts(LATEST, HISTORY, MODEL, CAPEX, COMMIT)
    calm = copy.deepcopy(base)
    calm.update({"compositeScore": 18.2, "band": "Low", "changeVsWeekAgo": -3.4, "changeVsMonthAgo": -9.8})
    beats = copy.deepcopy(base)
    beats["drawdownModel"].update({"chance": "48%", "baseRate": "27%", "beatsBaseRateReliably": True, "backtestAuc": 0.71})
    bare = copy.deepcopy(base)
    for k in ("drawdownModel", "hyperscalerCapex", "committedNotYetSpent"):
        bare.pop(k)
    return {"stretched": base, "calm": calm, "model beats base rate": beats, "market data only": bare}


def main() -> int:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    first = second = withheld = 0
    for name, facts in cases().items():
        for _ in range(n):
            out = generate(facts)
            if out["en"] is None:
                withheld += 1
                print(f"  {name}: withheld — {'; '.join(out['problems'])}")
                continue
            assert not check(out, facts)
            first += out["attempts"] == 1
            second += out["attempts"] == 2
    total = n * len(cases())
    print(f"{total} drafts: {first} passed first time, {second} after the rewrite, {withheld} withheld")
    return 0


if __name__ == "__main__":
    sys.exit(main())
