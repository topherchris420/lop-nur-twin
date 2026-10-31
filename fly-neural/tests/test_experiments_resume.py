import json

import numpy as np
import pytest

from fly_neural import connectome as cx
from fly_neural import experiments
from fly_neural.record import ProgressMismatch

# Synthetic: neuron 0 ("src") drives 1-4, which drive 5 ("out"). Not FlyWire's.
POPS = {"src": [0], "out": [5]}


def _setup(tmp_path, monkeypatch, cfg_overrides=None):
    pre, post, cnt = [0, 0, 0, 0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 5, 5, 5], [200, 200, 200, 200, 40, 40, 40, 40]
    c = cx.from_edges(np.arange(10, 16), pre, post, cnt, np.ones(6, dtype=np.int8), manifest={"sign_policy": "shiu"})
    compiled = cx.save(c, tmp_path / "toy")
    monkeypatch.setattr(experiments.P, "resolve", lambda key, c, root=None: (np.array(POPS[key], dtype=np.int64), {"key": key}))
    start = {"commit": "f" * 40, "dirty": False, "fly_neural": "digest"}

    def watch(_):
        def finish():
            return {**start, "changed_during_run": []}

        finish.start = start
        return finish

    monkeypatch.setattr(experiments, "code_watch", watch)
    cfg = {
        "schema": experiments.EXPERIMENT_SCHEMA,
        "id": "toy",
        "protocol": {"sign_policy": "shiu", "duration_ms": 100.0, "trials": 3},
        "seeds": {"dev": 1},
        "readouts": ["out"],
        "conditions": [{"name": f"src-{r}", "stimulate": {"src": r}} for r in (20, 50, 100)],
        "criteria": [{"id": "T1", "claim": "", "test": "mean_at_least", "condition": "src-100", "readout": "out", "min_hz": 1.0}],
        **(cfg_overrides or {}),
    }
    path = tmp_path / "toy.json"
    path.write_text(json.dumps(cfg))
    return path, compiled


def _strip(conds):
    return {k: {kk: vv for kk, vv in v.items() if kk != "resources"} for k, v in conds.items()}


def test_a_resumed_run_equals_an_uninterrupted_one(tmp_path, monkeypatch):
    cfg, compiled = _setup(tmp_path, monkeypatch)
    prog = tmp_path / "progress.jsonl"
    whole = experiments.run(cfg, "dev", compiled, tmp_path / "a", log=lambda *_: None, progress=prog)
    assert whole["resumed_conditions"] == []
    # As if killed after the first condition: keep the header and one finished condition.
    lines = prog.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 4
    prog.write_text("\n".join(lines[:2]) + "\n", encoding="utf-8")
    resumed = experiments.run(cfg, "dev", compiled, tmp_path / "b", log=lambda *_: None, progress=prog, resume=True)
    assert resumed["resumed_conditions"] == ["src-20"]
    assert _strip(resumed["conditions"]) == _strip(whole["conditions"])
    assert resumed["criteria"] == whole["criteria"]


def test_progress_of_another_run_is_refused(tmp_path, monkeypatch):
    cfg, compiled = _setup(tmp_path, monkeypatch)
    prog = tmp_path / "progress.jsonl"
    experiments.run(cfg, "dev", compiled, tmp_path / "a", log=lambda *_: None, progress=prog)
    cfg2, _ = _setup(tmp_path, monkeypatch, {"seeds": {"dev": 2}})  # a different config, same file name
    with pytest.raises(ProgressMismatch, match="config_sha256"):
        experiments.run(cfg2, "dev", compiled, tmp_path / "a", log=lambda *_: None, progress=prog, resume=True)


def test_without_resume_the_progress_file_starts_again(tmp_path, monkeypatch):
    cfg, compiled = _setup(tmp_path, monkeypatch)
    prog = tmp_path / "progress.jsonl"
    experiments.run(cfg, "dev", compiled, tmp_path / "a", log=lambda *_: None, progress=prog)
    again = experiments.run(cfg, "dev", compiled, tmp_path / "a", log=lambda *_: None, progress=prog)
    assert again["resumed_conditions"] == [] and len(prog.read_text(encoding="utf-8").splitlines()) == 4


def test_parallel_workers_merge_only_into_the_same_run(tmp_path):
    import json

    from fly_neural.record import append_progress, merge_progress, resume_progress

    head = {"experiment": "x", "split": "dev", "config_sha256": "c", "commit": "abc", "dirty": False, "only": None}
    a, b, other = tmp_path / "a.jsonl", tmp_path / "b.jsonl", tmp_path / "o.jsonl"
    resume_progress(a, {**head, "only": ["v2"]}, False, "subjects")
    resume_progress(b, {**head, "only": ["fixed"]}, False, "subjects")
    append_progress(a, {"name": "dev/v2/0", "result": {"li": -0.3}, "wall_s": 1})
    append_progress(b, {"name": "dev/fixed/0", "result": {"li": 0.0}, "wall_s": 1})
    done = merge_progress([a, b], head, "subjects", log=lambda *_: None)
    assert set(done) == {"dev/v2/0", "dev/fixed/0"}
    resume_progress(other, {**head, "commit": "def", "only": ["v2"]}, False, "subjects")
    with pytest.raises(ProgressMismatch, match="commit"):
        merge_progress([a, other], head, "subjects", log=lambda *_: None)
    append_progress(b, {"name": "dev/v2/0", "result": {"li": -0.2}, "wall_s": 1})
    with pytest.raises(ProgressMismatch, match="differs between workers"):
        merge_progress([a, b], head, "subjects", log=lambda *_: None)
    assert json.loads(a.read_text(encoding="utf-8").splitlines()[0])["only"] == ["v2"]


def test_shards_partition_the_split_and_merge_like_arm_workers(tmp_path):
    import json
    from pathlib import Path

    from fly_neural.record import append_progress, merge_progress, resume_progress
    from fly_neural.selective import unit_keys

    cfg = json.loads((Path(__file__).parents[1] / "experiments" / "plasticity-v2-v783.json").read_text(encoding="utf-8"))
    keys = unit_keys(cfg, "heldout", cfg["subjects"]["heldout"])
    assert len(keys) == len(set(keys)) == sum(len(r["arms"]) for r in cfg["runs"]["heldout"]) * cfg["subjects"]["heldout"]
    first = cfg["runs"]["heldout"][0]
    assert keys[0] == f"{first['pair']}/{first['arms'][0]}/0"
    assert unit_keys(cfg, "heldout", 2, only=["fixed"]) == [f"{r['pair']}/fixed/{s}" for r in cfg["runs"]["heldout"] if "fixed" in r["arms"] for s in range(2)]
    shards = [keys[i::32] for i in range(32)]
    assert sorted(k for s in shards for k in s) == sorted(keys)
    head = {"experiment": "x", "split": "heldout", "config_sha256": "c", "commit": "abc", "dirty": False, "only": None}
    files = []
    for i in (0, 1):
        f = tmp_path / f"s{i}.jsonl"
        resume_progress(f, {**head, "shard": [i, 32]}, False, "subjects")
        append_progress(f, {"name": shards[i][0], "result": {"li": i}, "wall_s": 1})
        files.append(f)
    assert set(merge_progress(files, head, "subjects", log=lambda *_: None)) == {shards[0][0], shards[1][0]}
    other = tmp_path / "other.jsonl"
    resume_progress(other, {**head, "config_sha256": "d", "shard": [2, 32]}, False, "subjects")
    with pytest.raises(ProgressMismatch, match="config_sha256"):
        merge_progress([*files, other], head, "subjects", log=lambda *_: None)
