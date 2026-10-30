import numpy as np
import pytest
from conftest import tiny_connectome

from fly_neural import controls, lif, stats


def chain_net(n=40, seed=0):
    rng = np.random.default_rng(seed)
    pre, post = np.nonzero(rng.random((n, n)) < 0.15)
    keep = pre != post
    pre, post = pre[keep], post[keep]
    sign = np.where(rng.random(n) < 0.7, 1, -1)
    return tiny_connectome(pre, post, rng.integers(1, 30, pre.size) * sign[pre], n)


@pytest.mark.parametrize("kind", controls.CONTROLS)
def test_controls_keep_what_they_claim(kind):
    c = chain_net()
    (indptr, indices, signed), st = controls.wiring(c, kind, seed=5)
    real = controls._signed(c)
    assert indptr.size == c.n + 1 and indices.size == signed.size == c.pairs
    assert st["pairs"] == c.pairs
    if kind in ("weight-shuffle", "random-graph"):
        assert sorted(np.abs(signed).tolist()) == sorted(np.abs(real).tolist()) or kind == "random-graph"
    if kind == "weight-shuffle":
        assert np.array_equal(indices, c.indices) and sorted(signed) == sorted(real)
    if kind == "degree-preserving":
        assert np.array_equal(indptr, c.indptr)  # out-degrees
        assert np.array_equal(np.bincount(indices, minlength=c.n), np.bincount(c.indices, minlength=c.n))  # in-degrees
        assert np.array_equal(signed, real)  # each neuron keeps its own outputs and sign
    if kind == "sign-shuffle":
        assert np.array_equal(indices, c.indices)
        assert np.array_equal(np.abs(signed), np.abs(real))
        assert (signed < 0).sum() != 0
    if kind == "random-graph":
        pre = np.repeat(np.arange(c.n), np.diff(indptr))
        assert st["autapses"] == 0 and not (pre == indices).any()
    assert not np.array_equal(signed, real) or not np.array_equal(indices, c.indices)
    lif.run(lif.Network(c, wiring=(indptr, indices, signed), label=kind), lif.Stimulus(poisson=[lif.Poisson(np.arange(4), 100.0)]), 50.0, rng=np.random.default_rng(0))


def test_controls_are_seeded():
    c = chain_net()
    a, _ = controls.wiring(c, "degree-preserving", 1)
    b, _ = controls.wiring(c, "degree-preserving", 1)
    d, _ = controls.wiring(c, "degree-preserving", 2)
    assert np.array_equal(a[1], b[1]) and not np.array_equal(a[1], d[1])


def test_control_wiring_must_fit():
    c = chain_net()
    (indptr, indices, signed), _ = controls.wiring(c, "weight-shuffle", 0)
    with pytest.raises(ValueError):
        lif.Network(c, wiring=(indptr[:-1], indices, signed))


def test_mann_whitney_matches_scipy():
    scipy_stats = pytest.importorskip("scipy.stats")
    rng = np.random.default_rng(3)
    for _ in range(20):
        a = rng.poisson(5, size=30).astype(float)
        b = rng.poisson(6, size=30).astype(float)
        for alt in ("two-sided", "less", "greater"):
            ours = stats.mann_whitney(a, b, alt)
            ref = scipy_stats.mannwhitneyu(a, b, alternative=alt, method="asymptotic", use_continuity=True)
            assert ours["u"] == pytest.approx(ref.statistic)
            assert ours["p"] == pytest.approx(ref.pvalue, rel=1e-6, abs=1e-12)


def test_wilson_interval():
    lo, hi = stats.wilson(30, 30)
    assert hi == pytest.approx(1.0) and 0.88 < lo < 0.89
    lo, hi = stats.wilson(1, 100)
    assert 0.001 < lo < 0.002 and 0.054 < hi < 0.055
