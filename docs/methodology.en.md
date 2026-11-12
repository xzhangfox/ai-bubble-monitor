<!-- Generated from content/documentation.en.json. Run npm run docs:build after editing. -->

# Documentation

Where the data comes from, what the indicators mean, and how the models are tested.

## Start here

A market thermometer, followed by a test of whether that thermometer can predict a fall.

The monitor asks two different questions: how stretched do AI-linked markets look today, and did similar conditions historically precede a substantial fall? The first is a transparent rules-based score; the second is a machine-learning experiment.

A score of 80 means the indicators are unusually elevated relative to their own histories. It does not mean an 80% chance of a crash. The model target is a specified future price fall, not a definitive label that a bubble exists.

The economic hypothesis is that rapid gains, concentrated leadership, easy risk-taking and aggressive investment can leave markets vulnerable if expectations disappoint. These are plausible warning signs to test, not proof of a bubble or a causal explanation of the next decline.

## Data sources & updates

Daily market prices and publicly filed company financial statements.

| Source | What is collected | How it is used |
| --- | --- | --- |
| Yahoo Finance | About ten years of daily prices and trading volumes through the Chart endpoint, with range=10y and interval=1d. | AI stock basket, market breadth, volatility, bond risk appetite, interest rates and volume. |
| SEC EDGAR · XBRL company facts | Filed capital expenditure and revenue for Microsoft, Alphabet, Amazon, Meta and Oracle. | Trailing-twelve-month aggregate capital expenditure divided by aggregate revenue. Each reading enters the history only after its filing date. |
| SEC EDGAR · 10-Q / 10-K text | Quarterly and annual filing passages about purchases, leases and other commitments. | Gemini extracts supported figures and original quotes for a separate commitments view; this text extraction is not itself the eighth score input. |

The AI basket contains NVDA, MSFT, GOOGL, AMZN, META, AVGO and ORCL. Price series are rebased and averaged into an equal-weight-at-inception basket. Additional symbols are ^VIX, ^RUT, ^TNX, HYG and IEF. Dates are aligned to a common trading calendar.

GitHub Actions runs on Tuesday–Saturday at 11:15 UTC, after the preceding US trading session, and can also be started manually. It fetches market series concurrently, computes features, runs the models and LLM steps, then publishes JSON/CSV artifacts with the site. This is a daily research dashboard, not a streaming quote feed.

Python steps can fail independently and keep their last good artifact. Market data, model results, filings and briefs may therefore have different as-of dates. A successful site load does not mean every upstream source refreshed successfully. SEC capital expenditure readings are carried forward between filings; without a usable SEC series, the score uses seven market indicators.

## Eight indicators, in plain language

Different views of price enthusiasm, risk-taking and corporate investment.

| Indicator | Calculation | Simple interpretation |
| --- | --- | --- |
| AI basket momentum | Basket return over 252 trading days. | Have AI-linked stocks already risen unusually far over roughly a year? |
| Distance above the long-term trend | Basket level / its 200-day moving average − 1. | Has price run far ahead of its own recent trend? This is a price proxy, not an earnings-based valuation measure. |
| Narrow market leadership | 126-day AI basket return minus Russell 2000 return. | Are gains concentrated in AI leaders while smaller companies lag? |
| Volatility complacency | Negative VIX level, ranked against its history. | Is the market pricing unusually little near-term volatility? Low VIX can also reflect genuinely calm conditions. |
| Credit risk appetite | 63-day HYG return minus IEF return. | Are riskier corporate bonds outperforming Treasuries? This is a risk-appetite proxy, not a direct measurement of investor leverage. |
| Interest-rate backdrop | Negative ten-year Treasury yield, ranked against its history. | Are lower long-term rates helping support high asset prices? Rates have other economic causes too. |
| Trading-volume surge | 20-day average of the basket’s combined trading volume / its 252-day average. | Has trading activity become unusually intense? Volume does not identify who is trading or why. |
| Capital expenditure intensity | Five hyperscalers’ aggregate trailing-twelve-month capital expenditure / aggregate revenue. | Are companies committing more current spending relative to sales? This covers company-wide capital expenditure, not exclusively AI investment. |

Each raw indicator becomes a 0–100 percentile using only observations available up to that historical day, including that day. The 90th percentile means a reading is above approximately 90% of its historical comparison values; it is not a 90% event probability. VIX and the ten-year yield are inverted so that higher ranks consistently point toward the hypothesized hotter conditions.

The composite is the equal-weighted average of the available indicator set: eight with a usable SEC series, otherwise seven. Equal weights keep the score transparent; they are not learned optimal weights and do not establish predictive skill.

The approach is inspired by public bubble frameworks associated with Dalio, Shiller and Minsky. It is a simplified set of measurable proxies, not a reproduction of a proprietary bubble gauge. Rising prices or spending can also reflect genuine earnings growth and productive investment.

## Models & their jobs

Compare simple explanations with more flexible models; keep text generation separate from forecasting.

| Method | Inputs | Why use it |
| --- | --- | --- |
| Calibrated composite | The single composite score, mapped to a probability with logistic regression. | Tests whether the simple thermometer alone carries useful information about later falls. |
| Logistic regression · scikit-learn | The individual indicator percentile ranks. | An interpretable benchmark: examine how each indicator changes the estimate. Weights describe associations, not causes. |
| Gradient-boosted trees · scikit-learn | Indicator ranks and each rank’s roughly one-month change. | Tests nonlinear combinations, such as multiple warning signs becoming elevated together. |
| Small Transformer · PyTorch | The previous 60 trading days of indicator ranks. | Tests whether the sequence of changing conditions adds information beyond one day’s readings. Greater complexity does not guarantee better results. |

Gemini has a different job: extract commitments from filings and write the bilingual daily brief from prepared facts. The default is gemini-3-flash-preview, configurable through GEMINI_MODEL. It does not directly produce the core statistical model probabilities.

An extracted figure must include a quote found verbatim in the filing, with the amount present. Briefing numbers are checked against supplied facts; a failed draft gets one repair attempt, then is withheld if it still fails. These checks constrain unsupported output but cannot guarantee the correct period, interpretation, completeness or translation.

### Implementation details

The multi-indicator logistic model uses C=0.5. HistGradientBoostingClassifier uses depth 3, learning rate 0.05, up to 200 iterations, minimum leaf size 40 and L2 regularization 1.0.

The Transformer has two encoder layers, hidden width 32, four attention heads, feed-forward width 64 and dropout 0.1. It uses learned positions, mean pooling, binary cross-entropy and AdamW, for up to 40 epochs with a time-separated validation holdout when enough data is available.

The initial training span has at least 504 usable trading days; subsequent training sets expand over time. The Transformer is skipped when PyTorch is unavailable.

## What is predicted & how it is tested

A specific future price event, evaluated on later periods the model did not train on.

The main target asks: does the AI basket close at least 10% below today’s close at any point in the next 63 trading days, roughly three months? If today’s index is 100, a future daily close of 90 or less counts. This is measured from today’s close, not from a later peak, and does not require the index to end the window down 10%.

The walk-forward test retrains every 63 trading days. Training includes only observations whose future outcome window has already finished before the test period begins, leaving a 63-day gap. A date’s percentile ranks use its past only; SEC information enters after filing. These choices reduce future-information leakage.

Fixed companion targets check a 15% fall within 126 trading days and a 20% fall within 252 days. They are reported alongside the primary target rather than picking whichever horizon looks best.

| Measure | Simple meaning | How to read it |
| --- | --- | --- |
| Out-of-sample AUC | How well the model ranks days that later experience the target fall above days that do not. | 0.5 is chance-level ranking; higher is better. A high AUC alone does not establish accurate probabilities. |
| Brier skill | Probability accuracy relative to a simple baseline using each training period’s historical event frequency. | Above 0 improves on the baseline; below 0 is worse. A predicted probability is not a guarantee. |
| 95% uncertainty interval | How much the estimated performance varies when history is resampled in quarter-length blocks, 1,000 times. | Wide intervals mean uncertain evidence. Blocks account for some time dependence; they do not create new independent market events. |

The website’s current-results panel reads the same model.json artifact as the dashboard. The conclusion follows the existing headline criterion: the selected model must have positive Brier skill and a positive lower 95% bound to be marked as beating the baseline. This is historical evidence, not a guarantee of future performance.

## What this can & cannot tell you

Measuring unusual conditions is easier than predicting when those conditions will reverse.

A high score can persist while prices continue rising. The score measures a hypothesized overheat pattern; only out-of-sample testing can establish whether it helps predict the defined fall.

The current basket is a fixed selection of today’s major AI-linked companies applied to history. This creates selection and survivorship limitations. Company-wide capital expenditure, VIX, bond returns and volume are imperfect proxies for AI-specific speculation.

Many daily labels overlap the same market decline. Thousands of observations do not mean thousands of independent crashes; the backtest reports the number of separate decline episodes. A short history and few episodes limit confidence, especially for a flexible neural network.

Financial relationships can change, data feeds can be revised or fail, and artifacts can become stale. The current backtest is a research result rather than an untouched final experiment; trying several models on one historical sample also creates model-selection uncertainty.

Use the dashboard to inspect conditions, compare explanations and assess the evidence. It has not established a reliable bubble-burst date or a profitable trading strategy.

## Source code & references

Follow each explanation back to its implementation.

- [Market ingestion, indicator formulas and scoring](https://github.com/xzhangfox/ai-bubble-monitor/blob/main/scripts/fetch-ai-bubble-data.mjs)
- [SEC capital expenditure and revenue](https://github.com/xzhangfox/ai-bubble-monitor/blob/main/ml/sec_capex.py)
- [Statistical models and walk-forward evaluation](https://github.com/xzhangfox/ai-bubble-monitor/blob/main/ml/model.py)
- [Filing extraction and bilingual briefing](https://github.com/xzhangfox/ai-bubble-monitor/tree/main/ml)
- [Daily update workflow](https://github.com/xzhangfox/ai-bubble-monitor/blob/main/.github/workflows/ai-bubble-data.yml)
- [Current model results · model.json](https://github.com/xzhangfox/ai-bubble-monitor/blob/main/data/ai-bubble/model.json)
- [SEC EDGAR API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
