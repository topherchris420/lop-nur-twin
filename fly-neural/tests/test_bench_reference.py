import json

import numpy as np
import pytest

from fly_neural import bench, reference
from fly_neural import connectome as cx
from fly_neural import populations as P


def test_scaling_measures_each_size():
    rows = bench.scaling([200, 400], degree=10, seed=3)
    assert [r["neurons"] for r in rows] == [200, 400]
    for r in rows:
        assert r["pairs"] > 0 and r["run"]["wall_s"] > 0 and r["run"]["gpu"] is None
        assert r["neurons_fired"] <= r["neurons_touched"] <= r["neurons"]


def _toy(tmp_path):
    """A synthetic connectome that happens to carry the root ids the comparison reads."""
    sugar = P.SHIU["sugar_shiu"][:5]
    ids = np.array(sorted(set(sugar) | {reference.MN9} | set(range(10, 40))), dtype=np.int64)
    n = ids.size
    mn9 = int(np.searchsorted(ids, reference.MN9))
    pre, post, cnt = [], [], []
    for s in sugar:
        i = int(np.searchsorted(ids, s))
        pre.append(i)
        post.append(mn9)
        cnt.append(60)
        for j in range(10, 20):  # graded drive, so downstream rates differ
            pre.append(i)
            post.append(int(np.searchsorted(ids, j)))
            cnt.append(15 + 6 * (j - 10))
    c = cx.from_edges(ids, pre, post, cnt, np.ones(n, dtype=np.int8), manifest={"sign_policy": "shiu"})
    return cx.save(c, tmp_path / "toy"), ids


def test_reference_judges_identical_runs_as_agreeing(tmp_path, monkeypatch):
    compiled, ids = _toy(tmp_path)
    cfg = {
        "schema": reference.SCHEMA,
        "id": "toy-reference",
        "engine": {"connectome": "toy", "population": "sugar_shiu", "rate_hz": 100.0, "duration_ms": 200.0, "trials": 6, "seed": 1},
        "criteria": [
            {"id": "R1", "claim": "", "test": "mn9_same", "alpha": 0.01},
            {"id": "R2", "claim": "", "test": "rate_correlation", "min_r": 0.95},
            {"id": "R3", "claim": "", "test": "responder_jaccard", "min_hz": 1.0, "min_jaccard": 0.8},
        ],
    }
    (tmp_path / "cfg.json").write_text(json.dumps(cfg))
    # A "Brian 2" file made by this engine on other seeds: the comparison must find agreement.
    from fly_neural import lif

    c = cx.load(compiled)
    net = lif.Network(c)
    idx, _ = P.resolve("sugar_shiu", c)
    trials = []
    for k in range(6):
        t, _ = lif.run(net, lif.Stimulus(poisson=[lif.Poisson(idx, 100.0)]), 200.0, rng=np.random.default_rng([99, k]))
        trials.append({"counts": {str(int(ids[i])): int(t.counts[i]) for i in np.flatnonzero(t.counts)}, "wall_s": 0.1, "brian2_seed": 99 + k})
    # Pooled from two runs, as when a run is stopped part way and the rest are run separately.
    head = {"schema": "fly-neural-brian2-trials/v1", "t_run_ms": 200.0, "args": {"rate": 100.0}, "environment": {"shiu_model_py_sha256": "x"}}
    (tmp_path / "b2a.json").write_text(json.dumps({**head, "trials": trials[:4]}))
    (tmp_path / "b2b.json").write_text(json.dumps({**head, "trials": trials[4:]}))
    monkeypatch.setattr(reference, "code_watch", lambda _: lambda: {"commit": None, "changed_during_run": []})
    data = reference.run(tmp_path / "cfg.json", [tmp_path / "b2a.json", tmp_path / "b2b.json"], compiled, tmp_path / "out", log=lambda *_: None)
    assert data["brian2_run"]["trials"] == 6 and len(data["brian2_run"]["files"]) == 2
    by = {v["id"]: v for v in data["criteria"]}
    assert by["R1"]["ours"]["mean"] > 0
    assert by["R2"]["neurons"] >= 5
    assert data["failed"] == [], [(v["id"], v.get("pearson_r"), v.get("jaccard"), v.get("mann_whitney")) for v in data["criteria"]]
    assert (tmp_path / "out" / "toy-reference.json").exists()


def test_pooling_refuses_a_different_setup_or_a_repeated_seed(tmp_path):
    head = {"schema": "fly-neural-brian2-trials/v1", "t_run_ms": 1000.0, "args": {"rate": 100.0}, "environment": {"shiu_model_py_sha256": "x"}}
    (tmp_path / "a.json").write_text(json.dumps({**head, "trials": [{"brian2_seed": 1}]}))
    (tmp_path / "b.json").write_text(json.dumps({**head, "args": {"rate": 50.0}, "trials": [{"brian2_seed": 2}]}))
    (tmp_path / "c.json").write_text(json.dumps({**head, "trials": [{"brian2_seed": 1}]}))
    with pytest.raises(ValueError, match="rate"):
        reference.read_brian2([tmp_path / "a.json", tmp_path / "b.json"])
    with pytest.raises(ValueError, match="seed repeats"):
        reference.read_brian2([tmp_path / "a.json", tmp_path / "c.json"])


def test_reference_refuses_other_files(tmp_path):
    (tmp_path / "x.json").write_text(json.dumps({"schema": "nope"}))
    with pytest.raises(ValueError):
        reference.run(tmp_path / "x.json", [tmp_path / "x.json"], tmp_path, tmp_path)
