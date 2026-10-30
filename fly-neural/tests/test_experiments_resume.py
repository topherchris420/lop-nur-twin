import json

import numpy as np
import pytest

from fly_neural import connectome as cx
from fly_neural import experiments

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
    with pytest.raises(experiments.ProgressMismatch, match="config_sha256"):
        experiments.run(cfg2, "dev", compiled, tmp_path / "a", log=lambda *_: None, progress=prog, resume=True)


def test_without_resume_the_progress_file_starts_again(tmp_path, monkeypatch):
    cfg, compiled = _setup(tmp_path, monkeypatch)
    prog = tmp_path / "progress.jsonl"
    experiments.run(cfg, "dev", compiled, tmp_path / "a", log=lambda *_: None, progress=prog)
    again = experiments.run(cfg, "dev", compiled, tmp_path / "a", log=lambda *_: None, progress=prog)
    assert again["resumed_conditions"] == [] and len(prog.read_text(encoding="utf-8").splitlines()) == 4
