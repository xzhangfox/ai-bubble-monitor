# AI Bubble Monitor

A daily, rules-based read on whether AI-linked markets show the classic signs of a speculative bubble, a test of whether that read says anything about what comes next, and an LLM pipeline that reads the hyperscalers' SEC filings — all rebuilt every trading day by GitHub Actions and published as a static Next.js site.

Live: https://ai-bubble-monitor-delta.vercel.app

## What runs each day

`.github/workflows/ai-bubble-data.yml`, after the US close:

| Step | Code | Writes |
|---|---|---|
| Hyperscaler capex vs revenue from SEC XBRL (Microsoft, Alphabet, Amazon, Meta, Oracle), trailing twelve months, as of each filing date | `ml/sec_capex.py` | `data/ai-bubble/sec-capex.json` |
| Ten years of Yahoo Finance prices → eight indicators, each a no-lookahead percentile rank, and their equal-weighted composite | `scripts/fetch-ai-bubble-data.mjs` | `latest.json`, `history.json`, `features.csv` |
| Drawdown model with a walk-forward backtest | `ml/model.py` | `model.json` |
| LLM reading of commitments in 10-Q/10-K filings, each figure checked against the filing | `ml/filings_llm.py` | `commitments.json` |
| LLM-written bilingual brief, published only if every number checks out | `ml/briefing.py` | `briefing.json` |

Each Python step may fail without stopping the update; its file keeps the last good version. Results and failures are reported as run annotations.

## The indicators

Seven daily market proxies for Ray Dalio's bubble hallmarks (with Shiller and Minsky): AI-basket momentum, stretch above the 200-day average, AI vs Russell 2000 breadth, VIX complacency, high-yield vs Treasury credit appetite, the 10-year yield, and volume surges. The eighth — "extended forward purchases" — is hyperscaler capital spending as a share of revenue from SEC filings, counted from the day after each filing. Every indicator is ranked only against its own history up to that day.

## The drawdown model

For each day: did the AI basket fall 10% or more below that close within 63 trading days?

- **Models:** the composite itself (rescaled to a probability), logistic regression on the eight ranks, gradient-boosted trees (adding each rank's one-month change), and a two-layer Transformer encoder over the last 60 days of all eight (PyTorch).
- **Walk-forward:** retrained every quarter on the past only, with a 63-day gap so no training outcome overlaps the days predicted.
- **Scoring:** out-of-sample ROC AUC and Brier skill against the base rate, with 95% moving-block-bootstrap intervals (quarter-long blocks).
- **Horizons fixed in advance:** a 15% fall within six months and a 20% fall within a year are reported alongside, so no horizon is picked out alone.
- **Today:** each model's probability, what moves the logistic estimate (in percentage points), and the most similar past days with what followed.

When no model beats the base rate, the page leads with the base rate and says so. So far that is the finding: the composite measures how stretched AI markets are, not when they turn.

## The LLM steps (Gemini)

- **Filings:** passages around commitment language ("not yet commenced", "purchase commitments"…) are sent with a JSON schema. A figure is kept only if its quoted sentence is in the filing word for word and contains the amount; dropped figures are counted. Each filing is read once.
- **Brief:** written from a facts object with every number already in display units. Any number not among the facts (including the model's own arithmetic) or advice language sends it back once with the problems named; if it still fails, nothing is published. `ml/eval_briefing.py` scores drafts over fixed cases.

## Run it locally

```bash
npm install && npm run dev                      # the site, from the committed data
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r ml/requirements.txt
python -m pytest -q ml/tests                    # Python tests (also run in CI)
python -m ml.model                              # rerun the backtest from features.csv
```

The LLM steps need a `GEMINI_API_KEY`; in Actions it is a repository secret. SEC requests identify themselves with `SEC_USER_AGENT` (a repository secret can override the default).

Educational tool only — not a trading signal and not investment advice.
