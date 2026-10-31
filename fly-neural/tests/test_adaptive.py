import json
from pathlib import Path

import numpy as np
import pytest

from fly_neural import adaptive as ad

DATA = Path(__file__).parent / "data"
V2 = json.loads((Path(__file__).parent.parent / "experiments" / "plasticity-v2-v783.json").read_text(encoding="utf-8"))
CFG = {
    "rule_v2": {"eta_dep": 0.5, "eta_ext": 0.3, "floor": 0.2, "e_sat": 3},
    "rule_v1": {"eta": 0.3, "e_sat": 3, "D_sat": 20},
    "reward_spikes_per_pam": 50,
    "approach_threshold": 0.3,
    "bookkeeping_misses": 2,
    "criterion": {"window": 10, "need": 8, "probe_first": 5},
    "experiments": {
        "relocation": {"visits": [30, 40], "perseveration_window": 10},
        "reversal": {"phases": 3, "visits_per_phase": 30},
        "retention": {"learn_visits": 30, "interference_visits": 30, "probe_visits": 6},
        "long-life": {"blocks": 4, "visits_per_block": 25},
    },
}


def _codes(odour_evoked_pam=0):
    """Four odours on 40 KCs (10 each, odour Asim sharing 6 of A's), two readout MBONs, two PAMs."""
    n_kc, odours = 40, ["A", "Asim", "B", "C"]
    cells = {"A": list(range(0, 10)), "Asim": list(range(4, 14)), "B": list(range(20, 30)), "C": list(range(30, 40))}
    K = np.zeros((4, 2, n_kc), dtype=np.int16)
    for i, o in enumerate(odours):
        K[i, :, cells[o]] = 4
    D = np.full((4, 2, 2), odour_evoked_pam, dtype=np.int16)
    pre = np.repeat(np.arange(n_kc), 2)
    post = np.tile([0, 1], n_kc)
    reach = np.array([[True, False], [False, True]])
    return ad.Codes(odours, {"sparse": K, "dense": K}, {"sparse": D, "dense": D}, pre, post, np.full(pre.size, 0.275), reach, {"npz_sha256": "x"})


def test_echo_mb_port_matches_the_typescript_model_exactly():
    ts = json.loads((DATA / "echo-mb-v2-parity.json").read_text(encoding="utf-8"))
    for arm, block in (("as-is", False), ("omission-blocked", True)):
        for subj in ts["arms"][arm]:
            mb = ad.EchoMB(subj["seed"], block_omission=block)
            tests = {}
            for ph in ts["schedule"]:
                for _ in range(ph["repeat"]):
                    for tok in ph["block"]:
                        cue = f"odour {tok.rstrip('+')}"
                        if not ph["plastic"]:
                            tests.setdefault(ph["name"], {})[tok] = mb.predict(cue)
                        else:
                            r = tok.endswith("+")
                            mb.trial(cue, 1.0 if r else 0.0, "meal" if r else "fruitless return")
            assert tests == subj["tests"], (arm, subj["seed"])


def test_parity_fixture_uses_plasticity_v2_schedule():
    ts = json.loads((DATA / "echo-mb-v2-parity.json").read_text(encoding="utf-8"))
    assert ts["schedule"] == V2["schedules"]["standard"]


def test_rule_v2_values_the_rewarded_odour_and_extinguishes_it():
    codes = _codes()
    a = ad.ConnectomeMB(codes, "sparse", "v2", CFG)
    rng = np.random.default_rng(0)
    for _ in range(3):
        a.learn("A", True, rng)
        a.learn("B", False, rng)
    va, vsim, vb = a.value("A", 0), a.value("Asim", 0), a.value("B", 0)
    assert va > 0.8 and vb == 0.0 and 0.2 < vsim < va  # Asim shares 6 of A's 10 cells
    for _ in range(6):
        a.learn("A", False, rng)
    assert a.value("A", 0) < 0.3 * va
    assert (a.w >= 0.2 * codes.w0 - 1e-12).all() and (a.w <= codes.w0 + 1e-12).all()


def test_rule_v1_with_odour_evoked_dopamine_values_every_odour_it_meets():
    a = ad.ConnectomeMB(_codes(odour_evoked_pam=30), "dense", "v1", CFG)
    rng = np.random.default_rng(0)
    for _ in range(3):
        a.learn("A", True, rng)
        a.learn("B", False, rng)
    assert a.value("B", 0) > 0.5 and a.value("C", 0) == 0.0
    # Without odour-evoked dopamine it is selective, but it can only depress: nothing extinguishes.
    b = ad.ConnectomeMB(_codes(), "sparse", "v1", CFG)
    for _ in range(3):
        b.learn("A", True, rng)
    peak = b.value("A", 0)
    for _ in range(5):
        b.learn("A", False, rng)
    assert b.value("B", 0) == 0.0 and b.value("A", 0) == peak


def test_ablations_do_what_they_say():
    rng = np.random.default_rng(1)
    for kw in ({"silenced": True},):
        a = ad.ConnectomeMB(_codes(), "sparse", "v2", CFG, **kw)
        a.learn("A", True, rng)
        assert a.value("A", 0) == 0.0
    nt = ad.ConnectomeMB(_codes(odour_evoked_pam=1), "sparse", "v2", CFG, no_threshold=True)
    nt.learn("B", False, rng)
    assert nt.value("B", 0) > 0.4  # any PAM spike counted as reward
    fixed = ad.ConnectomeMB(_codes(), "sparse", "none", CFG)
    fixed.learn("A", True, rng)
    assert fixed.value("A", 0) == 0.0


def test_bookkeeping_returns_until_two_misses():
    b = ad.Bookkeeping(2)
    rng = np.random.default_rng(0)
    b.learn("A", True, rng)
    assert b.choose(["A", "B", "C"], rng) == "A"
    b.learn("A", False, rng)
    assert b.choose(["A", "B", "C"], rng) == "A"
    b.learn("A", False, rng)
    assert all(b.choose(["A", "B", "C"], rng) != "A" for _ in range(20))


def test_trials_to_criterion():
    assert ad.trials_to_criterion(["x"] * 3 + ["t"] * 10, "t", 10, 8) == 1
    assert ad.trials_to_criterion(["x"] * 12, "t", 10, 8) == 12


@pytest.mark.parametrize("arm", [
    {"name": "full", "agent": "connectome-mb", "representation": "sparse", "rule": "v2"},
    {"name": "v1", "agent": "connectome-mb", "representation": "dense", "rule": "v1"},
    {"name": "echo-mb", "agent": "echo-mb"},
    {"name": "bookkeeping", "agent": "bookkeeping"},
])
def test_checkpoint_restore_continues_exactly(arm):
    codes = _codes()
    env = {"A": "A", "B": "B", "Asim": "Asim", "C": "C"}
    a = ad.run_life(arm, codes, CFG, "long-life", env, [], 7, "cfg", restore=True)
    b = ad.run_life(arm, codes, CFG, "long-life", env, [], 7, "cfg", restore=False)
    assert a["choices_sha256"] == b["choices_sha256"]
    ck = a["life"]["checkpoints"]
    assert [c["parent"] for c in ck] == [None] + [c["sha256"] for c in ck[:-1]]
    assert len({c["state_values"] for c in ck}) == 1  # bounded: the state holds as many numbers after every block


def test_restore_refuses_tampered_or_foreign_checkpoints():
    codes = _codes()
    arm = {"name": "full", "agent": "connectome-mb", "representation": "sparse", "rule": "v2"}
    s = ad.Subject("research-x-1", arm, codes, CFG, 1)
    s.visit(["A", "B"], "A")
    ck = json.loads(json.dumps(s.checkpoint("cfg")))
    t = ad.Subject("research-x-1", arm, codes, CFG, 1)
    t.restore(ck, "cfg")
    assert np.array_equal(t.agent.V, s.agent.V) and t.visits == 1
    bad = json.loads(json.dumps(ck))
    bad["state"]["V"][0] = 0.5
    with pytest.raises(ValueError, match="checksum"):
        ad.Subject("research-x-1", arm, codes, CFG, 1).restore(bad, "cfg")
    with pytest.raises(ValueError, match="another subject"):
        ad.Subject("research-x-2", arm, codes, CFG, 1).restore(ck, "cfg")
    with pytest.raises(ValueError, match="another subject"):
        ad.Subject("research-x-1", arm, codes, CFG, 1).restore(ck, "other-config")


def test_a_learning_agent_relearns_after_relocation_and_a_fixed_one_does_not():
    codes = _codes()
    env = {"A": "A", "B": "B", "Asim": "Asim", "C": "C"}
    full = {"name": "full", "agent": "connectome-mb", "representation": "sparse", "rule": "v2"}
    fixed = {"name": "fixed", "agent": "connectome-mb", "representation": "sparse", "rule": "none"}
    f = [ad.run_life(full, codes, CFG, "relocation", env, [], s, "cfg")["metrics"] for s in range(8)]
    x = [ad.run_life(fixed, codes, CFG, "relocation", env, [], s, "cfg")["metrics"] for s in range(8)]
    assert np.mean([m["relocation_ttc"] for m in f]) < np.mean([m["relocation_ttc"] for m in x])
    assert np.mean([m["meals_per_visit"] for m in f]) > np.mean([m["meals_per_visit"] for m in x])


def test_random_codes_keep_counts_and_drop_structure():
    codes = _codes().with_random("sparse", 3)
    K, R = codes.kc["sparse"], codes.kc["random"]
    assert (np.sort(K, axis=2) == np.sort(R, axis=2)).all()
    assert not np.array_equal(K, R)


def test_run_end_to_end_on_synthetic_codes(tmp_path):
    import hashlib

    from fly_neural.record import check_seal

    real = json.loads((Path(__file__).parent.parent / "experiments" / "adaptive-life-v783.json").read_text(encoding="utf-8"))
    cfg = {**real, "subjects": {"dev": 2, "heldout": 2}, "odour_sets": {"dev": {"A": "A", "B": "B", "Asim": "Asim", "C": "C"}}, "environments": {"dev": ["dev"]}, "interference": ["A", "B", "Asim", "C"]}
    cfg["experiments"] = {**CFG["experiments"], "long-life": {**CFG["experiments"]["long-life"], "arms": ["full", "echo-mb"]}}
    cfg["criteria"] = [c for c in real["criteria"] if c["id"] in ("XD",)] + [{**c, "split": "dev"} for c in real["criteria"] if c["id"] in ("A1", "E1", "P1", "P3")]
    path = tmp_path / "cfg.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    codes = _codes()
    codes.kc["thr-only"], codes.pam["thr-only"] = codes.kc["sparse"], codes.pam["sparse"]
    codes.meta = {"config_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "representations": {}, "connectome": {}}
    codes.save(tmp_path / "codes.npz")
    first = codes.meta["arrays_sha256"]
    codes.save(tmp_path / "again.npz")
    assert codes.meta["arrays_sha256"] == first == ad.Codes.load(tmp_path / "again.npz").meta["arrays_sha256"]
    data = ad.run(path, "dev", tmp_path / "codes.npz", tmp_path / "out", log=lambda *_: None)
    assert data["codes"]["arrays_sha256"] == first
    assert check_seal(data) and set(data["results"]) == set(real["run_experiments"])
    assert set(data["results"]["long-life"]) == {"full", "echo-mb"}
    assert {v["id"] for v in data["criteria"]} == {"XD", "A1", "E1", "P1", "P3"}
    p1 = next(v for v in data["criteria"] if v["id"] == "P1")
    assert p1["passed"] and p1["exact"] == 2 and p1["provenance_chained"]
