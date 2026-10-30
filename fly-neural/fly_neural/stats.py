"""The few statistics the experiments use, in numpy (no scipy dependency).

Mann-Whitney U uses the normal approximation with tie and continuity
corrections, which is adequate at the 30-trials-per-condition the experiments
run; Wilson's score interval is the one Shiu et al. report for proportions.
"""

from __future__ import annotations

import math

import numpy as np


def _rank(x: np.ndarray) -> np.ndarray:
    order = np.argsort(x, kind="mergesort")
    ranks = np.empty(x.size, dtype=np.float64)
    xs = x[order]
    i = 0
    while i < xs.size:
        j = i
        while j + 1 < xs.size and xs[j + 1] == xs[i]:
            j += 1
        ranks[order[i : j + 1]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def _norm_sf(z: float) -> float:
    return 0.5 * math.erfc(z / math.sqrt(2))


def mann_whitney(a, b, alternative: str = "two-sided") -> dict:
    """U test of a vs b. ``alternative`` "less" tests a < b, "greater" a > b."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    n1, n2 = a.size, b.size
    r = _rank(np.concatenate([a, b]))
    u1 = r[:n1].sum() - n1 * (n1 + 1) / 2
    mu = n1 * n2 / 2
    _, counts = np.unique(np.concatenate([a, b]), return_counts=True)
    n = n1 + n2
    tie = (counts**3 - counts).sum() / (n * (n - 1)) if n > 1 else 0.0
    sigma = math.sqrt(n1 * n2 / 12 * ((n + 1) - tie))
    if sigma == 0:
        return {"u": float(u1), "p": 1.0, "alternative": alternative, "note": "all values tied"}
    if alternative == "greater":
        p = _norm_sf((u1 - mu - 0.5) / sigma)
    elif alternative == "less":
        p = 1 - _norm_sf((u1 - mu + 0.5) / sigma)
    else:
        p = min(1.0, 2 * _norm_sf((abs(u1 - mu) - 0.5) / sigma))
    return {"u": float(u1), "p": float(p), "alternative": alternative}


def wilson(k: int, n: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def pearson(x, y) -> float | None:
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if x.size < 3 or x.std() == 0 or y.std() == 0:
        return None
    return float(np.corrcoef(x, y)[0, 1])


def summary(x) -> dict:
    x = np.asarray(x, dtype=np.float64)
    return {
        "n": int(x.size),
        "mean": float(x.mean()) if x.size else None,
        "sd": float(x.std(ddof=1)) if x.size > 1 else None,
        "median": float(np.median(x)) if x.size else None,
        "min": float(x.min()) if x.size else None,
        "max": float(x.max()) if x.size else None,
    }
