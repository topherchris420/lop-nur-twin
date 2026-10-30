import numpy as np

from fly_neural import connectome as cx
from fly_neural import lif, plasticity

# A synthetic mushroom body, not FlyWire's: odour A's input (8) drives KCs 0-1,
# odour B's (9) drives KCs 2-3; all four KCs excite MBON 4; PAMs 6-7 reach it.
KC, MBON, PAM, ODOUR = [0, 1, 2, 3], [4, 5], [6, 7], {"A": np.array([8]), "B": np.array([9])}
RULE = {"eta": 0.3, "e_sat": 3, "D_sat": 20, "dan_mbon_min_synapses": 5}
CFG = {
    "rule": RULE,
    "protocol": {"trial_ms": 100.0, "odour_rate_hz": 100.0, "reward_rate_hz": 100.0, "test_trials_per_odour": 2, "training_pairs": 3},
}


def _mb(monkeypatch):
    pre, post, cnt = [], [], []
    for o, kcs in ((8, (0, 1)), (9, (2, 3))):
        for k in kcs:
            pre.append(o), post.append(k), cnt.append(200)
    for k in KC:
        pre.append(k), post.append(4), cnt.append(60)
    for d in PAM:
        pre.append(d), post.append(4), cnt.append(5)
    c = cx.from_edges(np.arange(100, 112), pre, post, cnt, np.ones(12, dtype=np.int8))
    pops = {"kenyon_cells": KC, "mbons": MBON, "pam_dans": PAM}
    monkeypatch.setattr(plasticity.P, "resolve", lambda key, c, root=None: (np.array(pops[key], dtype=np.int64), {"key": key}))
    net = lif.Network(c)
    return c, net, plasticity.Circuit(c, net, RULE["dan_mbon_min_synapses"])


def test_circuit_reads_kc_mbon_edges_and_dan_reach(monkeypatch):
    _, _, circ = _mb(monkeypatch)
    d = circ.describe()
    assert (d["kc_mbon_synapse_pairs"], d["pam_innervated_mbons"], d["pam_mbon_links"]) == (4, 1, 2)
    assert circ.readout.tolist() == [4]


def test_only_the_rewarded_odours_synapses_weaken(monkeypatch):
    c, net, circ = _mb(monkeypatch)
    arm = {"name": "rule", "plastic": True, "silence_dans": False, "wiring": "connectome"}
    out = plasticity.run_subject(c, net, circ, CFG, arm, np.random.SeedSequence(5), ODOUR)
    assert out["li"] < 0
    # Per update: A trials depress the 2 edges of A's KCs; B trials, with no dopamine, none.
    assert out["synapses_depressed_per_update"]["max"] == 2 and out["synapses_depressed_per_update"]["min"] == 0
    assert out["kc_overlap_first_trials"] == 0.0 and out["kenyon_cells"] == 4


def test_fixed_and_lesioned_arms_change_no_weight(monkeypatch):
    c, net, circ = _mb(monkeypatch)
    w0 = net.weight.copy()
    for arm in ({"name": "fixed", "plastic": False, "silence_dans": False, "wiring": "connectome"}, {"name": "dan-lesion", "plastic": True, "silence_dans": True, "wiring": "connectome"}):
        out = plasticity.run_subject(c, net, circ, CFG, arm, np.random.SeedSequence(5), ODOUR)
        s = out["synapses_depressed_per_update"]
        assert s is None or s["max"] == 0, (arm["name"], s)
    assert np.array_equal(net.weight, w0)  # the subject's network is a copy
