"""The drawdown model's backtest: labels, the gap between training and test
days, out-of-sample scoring, and today's outputs."""

import unittest

import numpy as np
import pandas as pd

from ml import model as M


def synthetic(n=1500, k=3, seed=0):
    """A basket that falls hard after days when the first rank is high, so a
    model has something real to find."""
    rng = np.random.default_rng(seed)
    r0 = (np.sin(np.arange(n) / 40) + 1) / 2
    ranks = np.column_stack([r0] + [rng.uniform(0, 1, n) for _ in range(k - 1)])
    ret = rng.normal(0.0008, 0.01, n)
    hot = np.r_[np.zeros(20), r0[:-20]] > 0.8
    ret[hot] -= 0.012
    basket = 100 * np.cumprod(1 + ret)
    df = pd.DataFrame({"date": pd.bdate_range("2015-01-01", periods=n).strftime("%Y-%m-%d"), "basket": basket})
    for j in range(k):
        df[f"rank_{'abc'[j]}"] = ranks[:, j] * 100
    df["composite"] = ranks.mean(axis=1) * 100
    df.loc[:9, "rank_b"] = np.nan  # warm-up: not every indicator from day one
    return df


class Labels(unittest.TestCase):
    def test_label_is_a_ten_percent_fall_within_the_horizon(self):
        df = synthetic()
        f = M.load(df)
        b = df["basket"].to_numpy()
        start = len(df) - len(f.dates)
        for i in [0, 100, 500]:
            t = start + i
            fell = b[t + 1 : t + M.HORIZON + 1].min() / b[t] - 1 <= -M.DROP
            self.assertEqual(f.y[i], 1.0 if fell else 0.0)
        self.assertTrue(np.isnan(f.y[-M.HORIZON:]).all() and not np.isnan(f.y[-M.HORIZON - 1]))

    def test_burn_in_and_sequences(self):
        f = M.load(synthetic())
        self.assertEqual(f.seq_ranks.shape[1:], (M.SEQ, 3))
        np.testing.assert_allclose(f.seq_ranks[:, -1, :], f.ranks)


class Backtest(unittest.TestCase):
    def test_training_outcomes_end_before_each_test_quarter(self):
        f = M.load(synthetic())
        pairs = M.folds(f)
        self.assertGreater(len(pairs), 5)
        for train, test in pairs:
            self.assertLess(train.max() + M.HORIZON, test.min())  # its outcome window closed first
            self.assertGreaterEqual(len(train), M.MIN_TRAIN)
            self.assertFalse(np.isnan(f.y[test]).any())
        tests = np.concatenate([t for _, t in pairs])
        self.assertEqual(len(tests), len(set(tests.tolist())))

    def test_finds_a_real_signal_and_scores_it(self):
        out = M.run(synthetic(), ["composite", "logistic", "gbm"])
        by = {m["id"]: m for m in out["models"]}
        self.assertGreater(by["logistic"]["auc"], 0.7)
        for m in out["models"]:
            self.assertTrue(0 <= m["today"] <= 1)
            lo, hi = m["aucCi"]
            self.assertLessEqual(lo, m["auc"] + 1e-9)
            self.assertGreaterEqual(hi, m["auc"] - 1e-9)
        self.assertEqual(sum(c["days"] for c in out["calibration"]), out["backtest"]["days"])
        self.assertEqual(out["drivers"][0]["id"], "a")  # the rank that drives it
        self.assertEqual(len(out["analogs"]["days"]), 5)
        dates = [d["date"] for d in out["analogs"]["days"]]
        self.assertTrue(all(d < out["chart"][-1]["date"] for d in dates))
        self.assertIsNone(out["chart"][-1]["fell"])  # the latest days' outcomes aren't in yet

    def test_noise_does_not_beat_the_base_rate(self):
        df = synthetic(seed=3)
        rng = np.random.default_rng(1)
        df["basket"] = 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, len(df)))  # unrelated to the ranks
        out = M.run(df, ["logistic"])
        self.assertFalse(out["headline"]["beatsBaseRate"])


try:
    import torch  # noqa: F401

    HAVE_TORCH = True
except ImportError:
    HAVE_TORCH = False


@unittest.skipUnless(HAVE_TORCH, "PyTorch not installed")
class TransformerModel(unittest.TestCase):
    def test_learns_from_the_sequence_and_is_repeatable(self):
        f = M.load(synthetic(n=1200))
        labeled = np.where(~np.isnan(f.y))[0]
        train, test = labeled[:700], labeled[800:]
        p1 = M.fit_predict("transformer", f, train, test)
        p2 = M.fit_predict("transformer", f, train, test)
        self.assertEqual(p1.shape, (len(test),))
        self.assertTrue(((p1 >= 0) & (p1 <= 1)).all())
        np.testing.assert_allclose(p1, p2, atol=1e-6)  # seeded: the same every run
        from sklearn.metrics import roc_auc_score

        self.assertGreater(roc_auc_score(f.y[test], p1), 0.6)


class Small(unittest.TestCase):
    def test_episodes(self):
        y = np.array([0, 1, 1, 0, 0, 1] + [0] * 30 + [1, 1])
        self.assertEqual(M.episodes(y), 2)

    def test_brier_skill(self):
        y = np.array([0, 1, 0, 1.0])
        self.assertAlmostEqual(M.brier_skill(y, y, np.full(4, 0.5)), 1.0)
        self.assertAlmostEqual(M.brier_skill(np.full(4, 0.5), y, np.full(4, 0.5)), 0.0)


if __name__ == "__main__":
    unittest.main()
