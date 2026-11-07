"""Reduced circuits: the cut reproduces the whole network, and the conformance fixture is current."""

import json
from pathlib import Path

import numpy as np

from fly_neural import lif
from fly_neural.params import LIFParams
from fly_neural.reduce import conformance_fixture, cut, synthetic

FIXTURE = Path(__file__).resolve().parents[2] / "src" / "bethesda" / "ecology" / "connectome" / "fixtures" / "lif-conformance.json"


def test_a_cut_to_the_spiking_neurons_reproduces_the_network_spike_for_spike():
    c = synthetic(7, n=200, p_edge=0.06, inputs=10)
    net = lif.Network(c, LIFParams())
    inputs = np.arange(10, dtype=np.int64)
    stim = lambda idx: lif.Stimulus(poisson=[lif.Poisson(idx, 120.0)])  # noqa: E731
    t, _ = lif.run(net, stim(inputs), 300.0, rng=np.random.default_rng(1))
    keep = np.flatnonzero((t.counts > 0) | np.isin(np.arange(c.n), inputs))
    assert 10 < keep.size < c.n, "the test needs some silent neurons to cut away"
    red = cut(c, keep)
    new = np.full(c.n, -1)
    new[keep] = np.arange(keep.size)
    rnet = lif.Network(red, LIFParams())
    tf, _ = lif.run(net, stim(inputs), 300.0, rng=np.random.default_rng(1))
    tr, _ = lif.run(rnet, stim(new[inputs]), 300.0, rng=np.random.default_rng(1))
    assert np.array_equal(tf.counts[keep], tr.counts)
    assert tf.counts[np.setdiff1d(np.arange(c.n), keep)].sum() == 0


def test_the_typescript_conformance_fixture_is_current():
    fresh = conformance_fixture()
    assert fresh["spikes"], "the fixture must exercise spikes"
    committed = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(fresh)), "regenerate it: python -m fly_neural reduce fixture"
