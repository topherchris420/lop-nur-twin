"""The integrator against spike times Brian 2 recorded with Shiu et al.'s own model.py.

tests/data/brian2_conformance.json was written by
``reference/shiu_brian2.py conformance`` (Brian 2 2.9.0, numpy target): small
synthetic networks built by Shiu's ``create_model``/``silence``, driven by
deterministic kicks. Every spike must land on the same step in the same neuron.
"""

import json
from pathlib import Path

import numpy as np
import pytest
from conftest import tiny_connectome

from fly_neural import lif
from fly_neural.params import LIFParams

DATA = Path(__file__).parent / "data" / "brian2_conformance.json"
CASES = json.loads(DATA.read_text(encoding="utf-8"))["cases"]


def replay(case, **kw):
    c = tiny_connectome(case["pre"], case["post"], case["signed_count"], case["n"])
    net = lif.Network(c)
    stim = lif.Stimulus(
        kicks={int(s): np.array(v) for s, v in case["kicks"].items()},
        silenced=np.array(case["silenced"], dtype=np.int64),
    )
    trial, state = lif.run(net, stim, case["duration_ms"], rng=np.random.default_rng(0), max_logged_spikes=10**6, **kw)
    return net, stim, trial, state


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_matches_brian2_spike_for_spike(case):
    _, _, trial, _ = replay(case)
    ours = sorted(map(list, trial.spikes_logged.tolist()))
    assert ours == case["brian2_spikes"]
    assert trial.total_spikes == len(case["brian2_spikes"])


def test_conformance_cases_exercise_propagation_inhibition_and_refractoriness():
    kicked = {c["name"]: {j for v in c["kicks"].values() for j in v} for c in CASES}
    for c in CASES:
        spikers = {n for _, n in c["brian2_spikes"]}
        assert spikers - kicked[c["name"]], f"{c['name']}: only driven neurons spiked"
    assert any(s < 0 for c in CASES for s in c["signed_count"])


def test_checkpoint_resumes_bit_for_bit(tmp_path):
    case = CASES[1]
    c = tiny_connectome(case["pre"], case["post"], case["signed_count"], case["n"])
    net = lif.Network(c)
    stim = lif.Stimulus(poisson=[lif.Poisson(np.arange(5), 120.0)], silenced=np.array([7]))
    full, _ = lif.run(net, stim, 300.0, rng=np.random.default_rng(42), max_logged_spikes=10**6)
    first, state = lif.run(net, stim, 300.0, rng=np.random.default_rng(42), max_logged_spikes=10**6, stop_at_step=1234)
    lif.save_checkpoint(tmp_path / "ck.npz", state)
    resumed = lif.load_checkpoint(tmp_path / "ck.npz", net)
    rest, _ = lif.run(net, stim, 300.0, state=resumed, max_logged_spikes=10**6)
    joined = np.concatenate([first.spikes_logged, rest.spikes_logged])
    assert np.array_equal(joined, full.spikes_logged)
    assert np.array_equal(first.counts + rest.counts, full.counts)


def test_same_seed_same_spikes_different_seed_differs():
    case = CASES[1]
    c = tiny_connectome(case["pre"], case["post"], case["signed_count"], case["n"])
    net = lif.Network(c)
    stim = lif.Stimulus(poisson=[lif.Poisson(np.arange(5), 150.0)])
    a, _ = lif.run(net, stim, 200.0, rng=np.random.default_rng(1), max_logged_spikes=10**6)
    b, _ = lif.run(net, stim, 200.0, rng=np.random.default_rng(1), max_logged_spikes=10**6)
    d, _ = lif.run(net, stim, 200.0, rng=np.random.default_rng(2), max_logged_spikes=10**6)
    assert np.array_equal(a.spikes_logged, b.spikes_logged)
    assert not np.array_equal(a.spikes_logged, d.spikes_logged)


def test_poisson_rate_matches_target():
    c = tiny_connectome([0], [1], [1], 2)
    net = lif.Network(c)
    rates = []
    for s in range(20):
        t, _ = lif.run(net, lif.Stimulus(poisson=[lif.Poisson(np.array([0]), 100.0)]), 1000.0, rng=np.random.default_rng(s))
        rates.append(t.counts[0])
    # Each event spikes the next step unless it lands on a spike step (p = r dt).
    expected = 100.0 * (1 - 100.0 * 1e-4)
    assert abs(np.mean(rates) - expected) < 4 * np.sqrt(expected / 20)


def test_silencing_mutes_outgoing_only():
    c = tiny_connectome([0, 1], [1, 2], [200, 200], 3)
    net = lif.Network(c)
    kicks = {10: np.array([0]), 400: np.array([0])}
    t, _ = lif.run(net, lif.Stimulus(kicks=kicks), 80.0, max_logged_spikes=100)
    assert t.counts[1] > 0 and t.counts[2] > 0
    t, _ = lif.run(net, lif.Stimulus(kicks=kicks, silenced=np.array([1])), 80.0, max_logged_spikes=100)
    assert t.counts[1] > 0, "a silenced neuron still spikes"
    assert t.counts[2] == 0, "but its synapses are muted"


def test_spike_log_is_bounded_and_counts_are_not():
    case = CASES[3]
    _, _, trial, _ = replay(case)
    c = tiny_connectome(case["pre"], case["post"], case["signed_count"], case["n"])
    net = lif.Network(c)
    stim = lif.Stimulus(kicks={int(s): np.array(v) for s, v in case["kicks"].items()})
    t, _ = lif.run(net, stim, case["duration_ms"], max_logged_spikes=10)
    assert len(t.spikes_logged) == 10
    assert t.spikes_dropped == t.total_spikes - 10
    assert t.total_spikes > 10


def test_budget_stops_a_run(tmp_path):
    from fly_neural.resources import Budget, BudgetExceeded

    c = tiny_connectome([0], [1], [1], 2)
    net = lif.Network(c)
    stop = tmp_path / "stop"
    stop.write_text("")
    with pytest.raises(BudgetExceeded):
        lif.run(net, lif.Stimulus(), 500.0, budget=Budget(stop_file=stop, check_every_steps=100))


def test_params_have_sources():
    from fly_neural.params import PARAM_SOURCES

    assert set(PARAM_SOURCES) == set(LIFParams().as_dict())
    assert {v["status"] for v in PARAM_SOURCES.values()} <= {"cited", "free", "simulator", "assumption"}


def test_input_during_refractoriness_is_discarded_as_in_brian2():
    # Neuron 1 has the normal refractory period: neuron 2 (kicked) drives it to
    # spike at step S. Neuron 0's input then reaches 1 either inside its
    # refractory period (discarded) or after it (accepted).
    c = tiny_connectome([2, 0], [1, 1], [400, 100], 3)
    net = lif.Network(c)
    t, _ = lif.run(net, lif.Stimulus(kicks={0: np.array([2])}), 20.0, max_logged_spikes=10)
    S = [s for s, n in t.spikes_logged.tolist() if n == 1][0]
    delay = net.delay_steps

    def g1_after(arrive):
        kicks = {0: np.array([2]), arrive - delay - 1: np.array([0])}
        _, st = lif.run(net, lif.Stimulus(kicks=kicks), 20.0, stop_at_step=arrive + 1)
        return st.g[1]

    assert g1_after(S + 5) == 0.0
    assert g1_after(S + net.ref_steps + 3) > 0.0
