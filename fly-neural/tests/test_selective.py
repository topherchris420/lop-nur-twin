import copy

import numpy as np

from fly_neural import connectome as cx
from fly_neural import lif, mbcode, plasticity, selective

# A synthetic mushroom body, not FlyWire's: odour A's input (8) drives KCs 0-1,
# odour B's (9) drives KCs 2-3; all four KCs excite MBON 4; PAMs 6-7 reach it;
# neuron 10 is an "APL" that inhibits the KCs.
KC, MBON, PAM, APL, PN = [0, 1, 2, 3], [4, 5], [6, 7], [10], [8, 9]
ODOUR = {"A": np.array([8]), "B": np.array([9])}
CONST = {"eta_dep": 0.5, "eta_ext": 0.3, "floor": 0.2, "e_sat": 3, "tau_e_s": 1.0, "t_r_s": 0.1, "bin_ms": 10.0, "da_window_ms": 50.0}


def _mb():
    pre, post, cnt, sign = [], [], [], []
    for o, kcs in ((8, (0, 1)), (9, (2, 3))):
        for k in kcs:
            pre.append(o), post.append(k), cnt.append(200), sign.append(1)
    for k in KC:
        pre.append(k), post.append(4), cnt.append(60), sign.append(1)
        pre.append(10), post.append(k), cnt.append(3), sign.append(-1)
    for d in PAM:
        pre.append(d), post.append(4), cnt.append(5), sign.append(1)
    sgn = np.ones(11, dtype=np.int8)
    sgn[10] = -1
    c = cx.from_edges(np.arange(100, 111), pre, post, cnt, sgn)
    g = mbcode.Groups(c, kc=KC, mbon=MBON, pam=PAM, apl=APL, pn=PN)
    return c, lif.Network(c), g


def _trial(net, g, odour, reward, rng, ms=200.0):
    poi = [lif.Poisson(ODOUR[odour], 100.0, label=odour)]
    if reward:
        poi.append(lif.Poisson(g.pam, 100.0, label="PAM"))
    tr, _ = lif.run(net, lif.Stimulus(poisson=poi), ms, rng=rng, max_logged_spikes=100_000, log_neurons=np.concatenate([g.kc, g.pam]))
    return tr


def _bins(tr, net, g, syn, ms=200.0):
    kc_map = np.full(net.n, -1, dtype=np.int64)
    kc_map[g.kc] = np.arange(g.kc.size)
    nb = int(ms / 10)
    return selective.binned(tr, kc_map, g.kc.size, nb, 10.0, net.dt), selective.binned(tr, syn.pam_col, g.pam.size, nb, 10.0, net.dt)


def test_groups_and_synapses_read_the_readout_edges():
    c, net, g = _mb()
    assert g.readout.tolist() == [4]
    syn = selective.Synapses(net, g)
    assert syn.describe() == {"kc_readout_synapse_pairs": 4, "readout_mbons": 1, "pam_links": 2}
    assert sorted(syn.pre.tolist()) == KC and set(syn.post.tolist()) == {4}


def test_apply_changes_only_the_named_edges_and_leaves_the_network_alone():
    c, net, g = _mb()
    before = net.weight.copy()
    pre = np.repeat(np.arange(net.n), np.diff(net.indptr))
    post = np.asarray(net.indices)
    w = mbcode.apply(net, g, mbcode.Representation(apl_gain=4.0))
    assert np.array_equal(net.weight, before)
    changed = w != before
    assert changed.sum() == 4 and (pre[changed] == 10).all()
    assert np.allclose(w[changed], 4 * before[changed])
    w = mbcode.apply(net, g, mbcode.Representation(kc_threshold=2.0))
    onto = np.isin(post, KC)
    assert np.allclose(w[onto], before[onto] / 2) and np.array_equal(w[~onto], before[~onto])


def test_threshold_scaling_is_a_higher_threshold():
    """Every input x 1/k gives the spikes of a threshold k times further from rest, because the model
    resets to rest and is linear in its input (mbcode.Representation.kc_threshold relies on this)."""
    c, _, _ = _mb()
    k = 2.0
    p = lif.LIFParams()
    scaled = lif.Network(c, params=lif.LIFParams(w_syn_mV=p.w_syn_mV / k))
    high = lif.Network(c, params=lif.LIFParams(v_th_mV=p.v_0_mV + k * (p.v_th_mV - p.v_0_mV)))
    kicks = {s: np.array([8, 9]) for s in range(0, 2000, 3)}
    a, _ = lif.run(scaled, lif.Stimulus(kicks=kicks), 200.0, rng=np.random.default_rng(0))
    b, _ = lif.run(high, lif.Stimulus(kicks=kicks), 200.0, rng=np.random.default_rng(0))
    assert a.counts.sum() > 0 and np.array_equal(a.counts, b.counts)


def test_rule_v2_learns_the_rewarded_odour_only_and_extinguishes():
    c, net, g = _mb()
    syn = selective.Synapses(net, g)
    rule = selective.RuleV2(**CONST, theta_hz=20.0)
    rng = np.random.default_rng(1)
    for _ in range(4):
        for odour, rew in (("A", True), ("B", False)):
            tr = _trial(net, g, odour, rew, rng)
            kb, pb = _bins(tr, net, g, syn)
            selective.update_v2(syn, kb, pb, rule, False)
            syn.write(net, rule.floor)
    va = syn.V[np.isin(syn.pre, [0, 1])]
    vb = syn.V[np.isin(syn.pre, [2, 3])]
    assert (va > 0.5).all() and np.allclose(vb, 0.0)
    w = net.weight[syn.pos]
    assert (w >= rule.floor * syn.w0 - 1e-12).all() and (w <= syn.w0 + 1e-12).all()
    # Extinction: A without reward brings its synapses back toward naive.
    peak = va.copy()
    for _ in range(4):
        tr = _trial(net, g, "A", False, rng)
        kb, pb = _bins(tr, net, g, syn)
        selective.update_v2(syn, kb, pb, rule, False)
    assert (syn.V[np.isin(syn.pre, [0, 1])] < peak).all()


def test_rule_v2_does_nothing_without_dopamine_or_below_threshold():
    c, net, g = _mb()
    rng = np.random.default_rng(2)
    for blocked, theta in ((True, 20.0), (False, 1e6)):
        syn = selective.Synapses(net, g)
        rule = selective.RuleV2(**CONST, theta_hz=theta)
        tr = _trial(net, g, "A", True, rng)
        kb, pb = _bins(tr, net, g, syn)
        u = selective.update_v2(syn, kb, pb, rule, blocked)
        assert u["depressed"] == 0 and np.allclose(syn.V, 0.0)


def test_eligibility_trace_bridges_a_gap_and_its_absence_does_not():
    kc = np.zeros((1, 100))
    kc[0, 0:40] = 1.0  # odour 0-400 ms
    long = selective.eligibility(kc, selective.RuleV2(**CONST, theta_hz=1.0))
    short = selective.eligibility(kc, selective.RuleV2(**{**CONST, "tau_e_s": 0.001}, theta_hz=1.0))
    assert long[0, 60] > 0.5 and short[0, 60] < 1e-9  # at 600 ms, after a 200 ms gap


def test_compartment_rate_is_a_causal_window_mean():
    class S:
        reach = np.array([[1.0], [1.0]])
        reach_n = np.array([2.0])

    bins = np.zeros((2, 10))
    bins[0, 5] = 1  # one spike at bin 5
    r = selective.compartment_rate(S, bins, 10.0, 50.0)
    # 1 spike over 2 neurons over the 50 ms window: 10 Hz from bin 5 to bin 9, 0 before.
    assert np.allclose(r[0, 5:10], 10.0) and np.allclose(r[0, :5], 0.0)
    # Early in a trial the window is the time elapsed: a spike in bin 1 counts over 20 ms.
    early = np.zeros((2, 10))
    early[1, 1] = 1
    assert np.isclose(selective.compartment_rate(S, early, 10.0, 50.0)[0, 1], 25.0)


def test_update_v1_matches_the_original_rule(monkeypatch):
    c, net, g = _mb()
    syn = selective.Synapses(net, g)
    pops = {"kenyon_cells": KC, "mbons": MBON, "pam_dans": PAM}
    monkeypatch.setattr(plasticity.P, "resolve", lambda key, c, root=None: (np.array(pops[key], dtype=np.int64), {"key": key}))
    circ = plasticity.Circuit(c, net, 5)
    counts = np.zeros(net.n)
    counts[[0, 1, 2]] = [1, 4, 0]
    counts[PAM] = [7, 9]
    rule = {"eta": 0.3, "e_sat": 3, "D_sat": 20}
    w_ref = net.weight.copy()
    circ.update(w_ref, counts, rule, False)
    selective.update_v1(net, syn, counts, g, rule, False)
    assert np.allclose(net.weight, w_ref)


def test_shuffle_rewards_keeps_each_phase_count():
    trials = selective.expand([{"name": "pre", "plastic": False, "repeat": 2, "block": ["A", "B"]}, {"name": "acq", "plastic": True, "repeat": 8, "block": ["A+", "B"]}])
    out = selective.shuffle_rewards(trials, np.random.default_rng(3))
    assert sum(t[2] for t in out if t[0] == "acq") == 8 and not any(t[2] for t in out if t[0] == "pre")
    assert [t[1] for t in out] == [t[1] for t in trials]
    assert {t[1] for t in out if t[2]} == {"A", "B"}


def test_pn_kc_shuffle_keeps_degrees():
    c, net, g = _mb()
    n2 = copy.copy(net)
    pre = np.repeat(np.arange(net.n), np.diff(net.indptr))
    info = selective.pn_kc_shuffle(n2, g, 5)
    assert info["pn_kc_pairs_permuted"] == 4
    m = np.isin(pre, PN) & np.isin(np.asarray(net.indices), KC)
    assert sorted(np.asarray(n2.indices)[m].tolist()) == sorted(np.asarray(net.indices)[m].tolist())
    assert np.array_equal(np.asarray(n2.indices)[~m], np.asarray(net.indices)[~m])


def test_indices_and_judge():
    cfg = {"pretest_phase": "pre", "indices": {"li": {"terms": [[1, "t", "A"], [-1, "t", "B"]]}, "a": {"terms": [[1, "t", "A"]], "offset": -1.0}}}
    tests = {"pre": {"A": [100, 100], "B": [50]}, "t": {"A": [40], "B": [50]}}
    ix = selective.indices(tests, cfg)
    assert np.isclose(ix["li"], -0.6) and np.isclose(ix["a"], -0.6)
    arms = {"x": {"subjects": [{"indices": {"li": -0.5}}] * 8}, "y": {"subjects": [{"indices": {"li": 0.01 * k}} for k in range(8)]}}
    v = selective.judge({"id": "L1", "claim": "", "test": "all_negative", "arm": "x", "field": "li", "alpha": 0.01, "mean_at_most": -0.1}, arms)
    assert v["passed"] and v["sign_test_p"] < 0.004
    v = selective.judge({"id": "L2", "claim": "", "test": "mw_less", "a": "x", "b": "y", "field": "li", "alpha": 0.01}, arms)
    assert v["passed"]


def test_odour_rates_match_total_drive_and_cap():
    class G:
        @staticmethod
        def odour(names):
            return np.arange(sum({"x": 100, "y": 50, "z": 10}[n] for n in names))

    cfg = {"protocol": {"odour_rate_hz": 80.0, "odour_drive": "matched_total", "odour_rate_cap_hz": 200.0}, "odours": {"dev": {"A": ["x"]}}}
    odours = {k: G.odour(v) for k, v in {"A": ["x"], "B": ["y"], "C": ["z"]}.items()}
    assert selective.odour_rates(cfg, G, odours) == {"A": 80.0, "B": 160.0, "C": 200.0}
    cfg["protocol"].pop("odour_drive")
    assert set(selective.odour_rates(cfg, G, odours).values()) == {80.0}


def test_run_subject_runs_every_arm_kind_on_a_small_circuit():
    c, net, g = _mb()
    cfg = {
        "protocol": {
            "odour_rate_hz": 100.0,
            "reward_rate_hz": 100.0,
            "test_trial_ms": 100.0,
            "schedules": {
                "standard": {"phases": "standard", "trial_ms": 100.0, "odour_ms": None, "reward_ms": None},
                "trace": {"phases": "trace", "trial_ms": 200.0, "odour_ms": [0.0, 80.0], "reward_ms": [120.0, 200.0]},
            },
        },
        "schedules": {
            "standard": [
                {"name": "pre", "plastic": False, "repeat": 2, "block": ["A", "B"]},
                {"name": "acq", "plastic": True, "repeat": 4, "block": ["A+", "B"]},
                {"name": "test1", "plastic": False, "repeat": 2, "block": ["A", "B"]},
                {"name": "ext", "plastic": True, "repeat": 4, "block": ["A"]},
                {"name": "test3", "plastic": False, "repeat": 2, "block": ["A", "B"]},
            ],
            "trace": [
                {"name": "pre", "plastic": False, "repeat": 1, "block": ["A", "B"]},
                {"name": "acq", "plastic": True, "repeat": 3, "block": ["A+", "B"]},
                {"name": "test1", "plastic": False, "repeat": 1, "block": ["A", "B"]},
            ],
        },
        "pretest_phase": "pre",
        "acquisition_phase": "acq",
        "rule_v1": {"eta": 0.3, "e_sat": 3, "D_sat": 20},
        "rule_v2": {"constants": CONST},
        "indices": {"li_acq": {"terms": [[1, "test1", "A"], [-1, "test1", "B"]]}, "recovery": {"terms": [[1, "test3", "A"], [-1, "test1", "A"]]}},
    }
    arms = {
        "fixed": {"rule": "none"},
        "v1": {"rule": "v1"},
        "v2": {"rule": "v2"},
        "silenced": {"rule": "v2", "silence_dans": True},
        "shuffled": {"rule": "v2", "reward": "shuffled"},
        "rewired": {"rule": "v2", "wiring": "pn-kc-shuffle"},
        "trace": {"rule": "v2", "schedule": "trace"},
        "no-trace": {"rule": "v2", "schedule": "trace", "rule_v2_override": {"tau_e_s": 0.001}},
    }
    out = {}
    for name, arm in arms.items():
        before = net.weight.copy()
        out[name] = selective.run_subject(c, net, g, cfg, arm, mbcode.Representation(), 20.0, ODOUR, np.random.SeedSequence([1, 2]))
        assert np.array_equal(net.weight, before), "a subject must work on its own copy of the weights"
    assert out["fixed"]["updates"]["depressed"]["max"] == 0 and out["silenced"]["updates"]["depressed"]["max"] == 0
    assert out["v2"]["indices"]["li_acq"] < -0.2 and out["v2"]["indices"]["recovery"] > 0
    assert out["v1"]["indices"]["recovery"] <= 0.05  # v1 only depresses: nothing to recover
    assert out["trace"]["indices"]["recovery"] is None and out["trace"]["indices"]["li_acq"] is not None
    assert out["rewired"]["wiring"]["pn_kc_pairs_permuted"] == 4


def test_alln_gain_scales_only_excitatory_local_neuron_synapses():
    c, net, _ = _mb()
    # Treat input 8 (excitatory) and the APL 10 (inhibitory) as local neurons.
    g = mbcode.Groups(c, kc=KC, mbon=MBON, pam=PAM, apl=APL, pn=PN, ln=[8, 10])
    pre = np.repeat(np.arange(net.n), np.diff(net.indptr))
    w = mbcode.apply(net, g, mbcode.Representation(al_exc_ln=0.5))
    assert np.allclose(w[pre == 8], net.weight[pre == 8] / 2)
    assert np.array_equal(w[pre != 8], net.weight[pre != 8])
    assert mbcode.Representation(al_exc_ln=0.5).label() == "apl1-thr1-kckc1-alln0.5"
    assert mbcode.Representation().label() == "apl1-thr1-kckc1" and mbcode.Representation().identity
