"""Does the bubble score mean anything? The composite says how stretched AI
markets look; this asks what usually came next. For every day it estimates
the chance that the AI basket falls 10% or more below that day's close within
the next three months (63 trading days), and tests that honestly:

- Walk-forward backtest: retrain every quarter on the past only, predict the
  next quarter, with a 63-day gap so no training label overlaps the test days.
- Four models side by side: the composite itself (rescaled to a probability),
  logistic regression on the eight indicators, gradient-boosted trees (adding
  each indicator's one-month change), and a small Transformer that reads the
  last 60 days of all eight.
- Scored out of sample: ROC AUC, Brier score and Brier skill against the base
  rate, with block-bootstrap intervals — ten years hold only a handful of
  separate drawdowns, and the intervals say so.
- Today: each model's probability, what pushes the logistic model's estimate
  up or down, and the most similar days in the past and what followed them.
- Two longer horizons, fixed in advance and always reported together — a 15%
  fall within six months, a 20% fall within a year — for the composite and
  the logistic model, so a result at one horizon can't be picked out alone.

Reads data/ai-bubble/features.csv (from the Node script); writes model.json.

    python -m ml.model
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

from ml.common import DATA_DIR, annotate, write_json

HORIZON = 63  # trading days ahead
DROP = 0.10  # a fall of this much below the day's close counts
LONGER = [(126, 0.15), (252, 0.20)]  # the other horizons, reported alongside
MIN_TRAIN = 504  # two years before the first test quarter
STEP = 63  # retrain every quarter
SEQ = 60  # days the Transformer reads
BURN_IN = 126  # first days with every rank: too few points behind each rank to trust
CHANGE = 21  # the trees also see each rank's one-month change
BOOTSTRAP = 1000
SEED = 7

NAMES = {
    "composite": "Composite score",
    "logistic": "Logistic regression",
    "gbm": "Gradient-boosted trees",
    "transformer": "Transformer (60-day sequence)",
}


# ---------------------------------------------------------------- data

@dataclass
class Frame:
    dates: np.ndarray  # str, usable days
    ids: list[str]  # indicator ids
    ranks: np.ndarray  # (n, k) in 0..1
    composite: np.ndarray  # (n,) in 0..1
    basket: np.ndarray  # (n,)
    seq_ranks: np.ndarray  # (n, SEQ, k): the SEQ days up to each day
    y: np.ndarray  # (n,) 1/0, nan where the outcome isn't known yet
    fwd_return: np.ndarray
    fwd_drawdown: np.ndarray
    horizon: int = HORIZON
    drop: float = DROP


def load(df: pd.DataFrame, horizon: int = HORIZON, drop: float = DROP) -> Frame:
    ids = [c[5:] for c in df.columns if c.startswith("rank_")]
    rank_cols = [f"rank_{i}" for i in ids]
    ok = df[rank_cols + ["composite", "basket"]].notna().all(axis=1).to_numpy()
    first = int(np.argmax(ok)) if ok.any() else len(df)
    if not ok[first:].all():
        # (a gap later on: use the run that reaches today)
        bad = np.where(~ok)[0]
        first = int(bad[-1]) + 1
    all_ranks = df[rank_cols].to_numpy(dtype=float) / 100.0
    start = first + max(BURN_IN, SEQ - 1)
    if len(df) - start < MIN_TRAIN + horizon + STEP:
        raise ValueError(f"only {len(df) - start} usable days")
    basket = df["basket"].to_numpy(dtype=float)
    n_all = len(df)
    y = np.full(n_all, np.nan)
    fwd_ret = np.full(n_all, np.nan)
    fwd_dd = np.full(n_all, np.nan)
    for t in range(n_all - horizon):
        window = basket[t + 1 : t + horizon + 1]
        fwd_dd[t] = window.min() / basket[t] - 1
        fwd_ret[t] = basket[t + horizon] / basket[t] - 1
        y[t] = 1.0 if fwd_dd[t] <= -drop else 0.0
    idx = np.arange(start, n_all)
    seq = np.stack([all_ranks[t - SEQ + 1 : t + 1] for t in idx])
    return Frame(
        dates=df["date"].to_numpy()[idx],
        ids=ids,
        ranks=all_ranks[idx],
        composite=df["composite"].to_numpy(dtype=float)[idx] / 100.0,
        basket=basket[idx],
        seq_ranks=seq,
        y=y[idx],
        fwd_return=fwd_ret[idx],
        fwd_drawdown=fwd_dd[idx],
        horizon=horizon,
        drop=drop,
    )


def with_changes(f: Frame) -> np.ndarray:
    """Ranks plus each rank's change over the last month (from the sequences)."""
    return np.hstack([f.ranks, f.ranks - f.seq_ranks[:, -CHANGE, :]])


# ---------------------------------------------------------------- models

def fit_predict(model: str, f: Frame, train: np.ndarray, test: np.ndarray) -> np.ndarray:
    yt = f.y[train]
    if yt.min() == yt.max():  # one class only: all we know is the base rate
        return np.full(len(test), yt.mean())
    if model == "composite":
        m = LogisticRegression(C=1e6, max_iter=1000).fit(f.composite[train, None], yt)
        return m.predict_proba(f.composite[test, None])[:, 1]
    if model == "logistic":
        m = LogisticRegression(C=0.5, max_iter=2000).fit(f.ranks[train], yt)
        return m.predict_proba(f.ranks[test])[:, 1]
    if model == "gbm":
        x = with_changes(f)
        m = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, min_samples_leaf=40, l2_regularization=1.0, random_state=SEED)
        m.fit(x[train], yt)
        return m.predict_proba(x[test])[:, 1]
    if model == "transformer":
        return transformer_fit_predict(f.seq_ranks[train], yt, f.seq_ranks[test], gap=f.horizon)
    raise ValueError(model)


def transformer_fit_predict(x_train: np.ndarray, y_train: np.ndarray, x_test: np.ndarray, *, gap: int = HORIZON, epochs: int = 40) -> np.ndarray:
    """A two-layer Transformer encoder over the last 60 days of the eight
    ranks. Early-stopped on the last fifth of the training span, which is
    kept `gap` days clear of what it trains on."""
    import torch
    from torch import nn

    torch.manual_seed(SEED)
    torch.set_num_threads(1)
    k = x_train.shape[2]

    class Net(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.inp = nn.Linear(k, 32)
            self.pos = nn.Parameter(torch.zeros(1, x_train.shape[1], 32))
            layer = nn.TransformerEncoderLayer(d_model=32, nhead=4, dim_feedforward=64, dropout=0.1, batch_first=True)
            self.enc = nn.TransformerEncoder(layer, num_layers=2)
            self.out = nn.Linear(32, 1)

        def forward(self, x):  # (B, T, k) -> (B,)
            h = self.enc(self.inp(x) + self.pos)
            return self.out(h.mean(dim=1)).squeeze(-1)

    n = len(x_train)
    cut = int(n * 0.8)
    fit_end = cut - gap
    if fit_end < 200 or y_train[cut:].min() == y_train[cut:].max():
        fit_end, cut = n, n  # too little to hold out: fixed epochs
    xt = torch.tensor(x_train[:fit_end], dtype=torch.float32)
    yt = torch.tensor(y_train[:fit_end], dtype=torch.float32)
    xv = torch.tensor(x_train[cut:], dtype=torch.float32)
    yv = torch.tensor(y_train[cut:], dtype=torch.float32)
    net = Net()
    opt = torch.optim.AdamW(net.parameters(), lr=1e-3, weight_decay=1e-3)
    loss_fn = nn.BCEWithLogitsLoss()
    gen = torch.Generator().manual_seed(SEED)
    best, best_state, since_best = math.inf, None, 0
    for _ in range(epochs):
        net.train()
        order = torch.randperm(len(xt), generator=gen)
        for i in range(0, len(xt), 64):
            b = order[i : i + 64]
            opt.zero_grad()
            loss_fn(net(xt[b]), yt[b]).backward()
            opt.step()
        if len(xv):
            net.eval()
            with torch.no_grad():
                v = loss_fn(net(xv), yv).item()
            if v < best - 1e-4:
                best, since_best = v, 0
                best_state = {key: val.clone() for key, val in net.state_dict().items()}
            else:
                since_best += 1
                if since_best >= 6:
                    break
    if best_state is not None:
        net.load_state_dict(best_state)
    net.eval()
    with torch.no_grad():
        return torch.sigmoid(net(torch.tensor(x_test, dtype=torch.float32))).numpy()


def available_models() -> list[str]:
    try:
        import torch  # noqa: F401

        return ["composite", "logistic", "gbm", "transformer"]
    except ImportError:
        print("PyTorch isn't installed — skipping the Transformer", file=sys.stderr)
        return ["composite", "logistic", "gbm"]


# ---------------------------------------------------------------- backtest

def folds(f: Frame) -> list[tuple[np.ndarray, np.ndarray]]:
    """(train, test) index pairs: each test quarter is predicted by a model
    trained only on days whose three-month outcome was over before it began."""
    labeled_end = int(np.where(~np.isnan(f.y))[0][-1])
    out = []
    s = MIN_TRAIN + f.horizon
    while s <= labeled_end:
        train = np.arange(0, s - f.horizon)
        test = np.arange(s, min(s + STEP, labeled_end + 1))
        out.append((train, test))
        s += STEP
    return out


def walk_forward(f: Frame, models: list[str]) -> dict[str, np.ndarray]:
    """Out-of-sample predictions per model, plus the base rate each fold knew."""
    pairs = folds(f)
    test_idx = np.concatenate([t for _, t in pairs])
    out = {"index": test_idx, "climatology": np.concatenate([np.full(len(t), f.y[tr].mean()) for tr, t in pairs])}
    for m in models:
        out[m] = np.concatenate([fit_predict(m, f, tr, t) for tr, t in pairs])
    return out


def brier_skill(p: np.ndarray, y: np.ndarray, clim: np.ndarray) -> float:
    ref = np.mean((clim - y) ** 2)
    return float(1 - np.mean((p - y) ** 2) / ref) if ref > 0 else float("nan")


def block_bootstrap(p: np.ndarray, y: np.ndarray, clim: np.ndarray, *, block: int, reps: int = BOOTSTRAP) -> tuple[list[float], list[float]]:
    """95% intervals for AUC and Brier skill, resampling quarter-long blocks
    (the days inside a block share one outcome window, so they move together)."""
    rng = np.random.default_rng(SEED)
    n = len(y)
    starts = np.arange(0, max(1, n - block + 1))
    aucs, skills = [], []
    for _ in range(reps):
        pick = rng.choice(starts, size=math.ceil(n / block))
        idx = np.concatenate([np.arange(s, min(s + block, n)) for s in pick])[:n]
        if y[idx].min() == y[idx].max():
            continue
        aucs.append(roc_auc_score(y[idx], p[idx]))
        skills.append(brier_skill(p[idx], y[idx], clim[idx]))
    q = lambda xs: [round(float(np.percentile(xs, 2.5)), 3), round(float(np.percentile(xs, 97.5)), 3)] if xs else [None, None]
    return q(aucs), q(skills)


def episodes(y: np.ndarray, gap: int = 21) -> int:
    """Separate drawdowns: runs of 1s, merged when less than a month apart."""
    count, last = 0, -10**9
    for i, v in enumerate(y):
        if v == 1:
            if i - last > gap:
                count += 1
            last = i
    return count


def calibration(p: np.ndarray, y: np.ndarray) -> list[dict]:
    edges = [0, 0.1, 0.2, 0.35, 0.5, 1.0001]
    out = []
    for lo, hi in zip(edges, edges[1:]):
        m = (p >= lo) & (p < hi)
        if m.sum() == 0:
            continue
        out.append({"from": lo, "to": min(hi, 1.0), "days": int(m.sum()), "predicted": round(float(p[m].mean()), 3), "observed": round(float(y[m].mean()), 3)})
    return out


def score(f: Frame, wf: dict[str, np.ndarray], m: str) -> dict:
    """Out-of-sample AUC and Brier skill, with their intervals."""
    y, p, clim = f.y[wf["index"]], wf[m], wf["climatology"]
    auc_ci, skill_ci = block_bootstrap(p, y, clim, block=f.horizon)
    return {
        "id": m,
        "name": NAMES[m],
        "auc": round(float(roc_auc_score(y, p)), 3),
        "aucCi": auc_ci,
        "brier": round(float(np.mean((p - y) ** 2)), 4),
        "brierSkill": round(brier_skill(p, y, clim), 3),
        "brierSkillCi": skill_ci,
    }


def longer_horizons(df: pd.DataFrame) -> list[dict]:
    out = []
    for horizon, drop in LONGER:
        f = load(df, horizon, drop)
        models = ["composite", "logistic"]
        wf = walk_forward(f, models)
        y = f.y[wf["index"]]
        out.append(
            {
                "horizonDays": horizon,
                "drop": drop,
                "start": str(f.dates[wf["index"][0]]),
                "end": str(f.dates[wf["index"][-1]]),
                "baseRate": round(float(y.mean()), 3),
                "episodes": episodes(y),
                "models": [score(f, wf, m) for m in models],
            }
        )
    return out


# ---------------------------------------------------------------- today

def drivers(f: Frame, labeled: np.ndarray) -> list[dict]:
    """What moves the logistic model's estimate today: each indicator's weight
    times how far today's rank sits from its average (log-odds), and what the
    estimate would be, in points, with that indicator at its average instead."""
    m = LogisticRegression(C=0.5, max_iter=2000).fit(f.ranks[labeled], f.y[labeled])
    mean = f.ranks[labeled].mean(axis=0)
    today = f.ranks[-1]
    p_today = m.predict_proba(today[None])[0, 1]
    rows = []
    for j, i in enumerate(f.ids):
        at_mean = today.copy()
        at_mean[j] = mean[j]
        rows.append(
            {
                "id": i,
                "rank": round(float(today[j] * 100), 1),
                "weight": round(float(m.coef_[0][j]), 3),
                "contribution": round(float(m.coef_[0][j] * (today[j] - mean[j])), 3),
                "effect": round(float(p_today - m.predict_proba(at_mean[None])[0, 1]), 3),
            }
        )
    return sorted(rows, key=lambda r: -abs(r["contribution"]))


def analogs(f: Frame, labeled: np.ndarray, *, top: int = 5, apart: int = 42, k: int = 50) -> dict:
    """The past days whose eight ranks sit closest to today's, a couple of
    months apart from each other, and what followed each."""
    d = np.sqrt(((f.ranks[labeled] - f.ranks[-1]) ** 2).sum(axis=1))
    order = np.argsort(d)
    picks: list[int] = []
    for o in order:
        t = int(labeled[o])
        if all(abs(t - p) >= apart for p in picks):
            picks.append(t)
        if len(picks) == top:
            break
    max_d = math.sqrt(f.ranks.shape[1])
    near = labeled[order[:k]]
    return {
        "days": [
            {
                "date": str(f.dates[t]),
                "composite": round(float(f.composite[t] * 100), 1),
                "similarity": round(float(1 - np.sqrt(((f.ranks[t] - f.ranks[-1]) ** 2).sum()) / max_d), 3),
                "forwardReturn": round(float(f.fwd_return[t]), 4),
                "maxDrawdown": round(float(f.fwd_drawdown[t]), 4),
                "fell": bool(f.y[t] == 1),
            }
            for t in picks
        ],
        "nearest": k,
        "nearestFell": round(float(f.y[near].mean()), 3),
    }


# ---------------------------------------------------------------- run

def run(df: pd.DataFrame, models: list[str] | None = None, *, longer: bool = True) -> dict:
    f = load(df)
    models = models or available_models()
    wf = walk_forward(f, models)
    idx, clim = wf["index"], wf["climatology"]
    y = f.y[idx]
    labeled = np.where(~np.isnan(f.y))[0]
    today = np.array([len(f.dates) - 1])

    results = [{**score(f, wf, m), "today": round(float(fit_predict(m, f, labeled, today)[0]), 3)} for m in models]
    best = max(results, key=lambda r: r["brierSkill"])
    head = best["id"]

    # The headline model's line for the chart: out of sample where the outcome
    # is known, then the final model over the days still waiting on theirs.
    pending = np.arange(labeled[-1] + 1, len(f.dates))
    live = fit_predict(head, f, labeled, pending) if len(pending) else np.array([])
    chart = [{"date": str(f.dates[t]), "p": round(float(p), 3), "fell": int(f.y[t])} for t, p in zip(idx, wf[head])]
    chart += [{"date": str(f.dates[t]), "p": round(float(p), 3), "fell": None} for t, p in zip(pending, live)]
    weekly = chart[::5] + ([chart[-1]] if (len(chart) - 1) % 5 else [])

    return {
        "asOf": str(f.dates[-1]),
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "target": {
            "horizonDays": HORIZON,
            "drop": DROP,
            "text": "A fall of 10% or more in the AI basket below the day's close at any point in the next 63 trading days (about three months).",
        },
        "backtest": {
            "start": str(f.dates[idx[0]]),
            "end": str(f.dates[idx[-1]]),
            "days": int(len(idx)),
            "folds": len(folds(f)),
            "retrainEveryDays": STEP,
            "gapDays": HORIZON,
            "minTrainDays": MIN_TRAIN,
            "baseRate": round(float(y.mean()), 3),
            "episodes": episodes(y),
        },
        "models": results,
        "headline": {
            "model": head,
            "probability": best["today"],
            "baseRate": round(float(f.y[labeled].mean()), 3),
            "chosenBy": "highest out-of-sample Brier skill",
            # Better than the base rate only if even the low end of its interval is.
            "beatsBaseRate": bool(best["brierSkill"] > 0 and (best["brierSkillCi"][0] or 0) > 0),
        },
        "calibration": calibration(wf[head], y),
        "drivers": drivers(f, labeled),
        "analogs": analogs(f, labeled),
        "chart": weekly,
        "longerHorizons": longer_horizons(df) if longer else [],
    }


def main() -> int:
    try:
        df = pd.read_csv(DATA_DIR / "features.csv")
        out = run(df)
    except Exception as err:
        annotate("error", "Drawdown model", str(err))
        return 1
    write_json("model.json", out)
    h, b = out["headline"], out["backtest"]
    annotate(
        "notice",
        "Drawdown model",
        f"{out['asOf']}: {NAMES[h['model']]} {h['probability']:.0%} vs base rate {h['baseRate']:.0%} "
        f"({'beats' if h['beatsBaseRate'] else 'does not beat'} it); backtest {b['start']}..{b['end']}, {b['episodes']} drawdowns",
    )
    for m in out["models"]:
        annotate("notice", f"Model {m['id']}", f"AUC {m['auc']:.3f} {m['aucCi']}, Brier skill {m['brierSkill']:+.3f} {m['brierSkillCi']}, today {m['today']:.0%}")
    for hz in out["longerHorizons"]:
        c = hz["models"][0]
        annotate("notice", f"Horizon {hz['horizonDays']}d", f"{hz['drop']:.0%} fall, base rate {hz['baseRate']:.0%}: composite AUC {c['auc']:.3f} {c['aucCi']}, Brier skill {c['brierSkill']:+.3f}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
