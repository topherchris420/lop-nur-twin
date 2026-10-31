import io
import json

import pytest

from fly_neural import closedloop as cl
from fly_neural.resources import BudgetExceeded
from fly_neural.shadow import RefusedSubject

HEAD = {"schema": "fly-neural-shadow/v1", "mode": "neural-experimental", "subject": "research-looms-1", "seed": 1, "arm": "neural-merged"}
OBS = {"looming": None, "airflow": 0.0, "airflowFrom": None, "odour": 0.0, "onFood": False}


class FakeBrain:
    """Stands in for the full model: the giant fiber fires 2 spikes in every window after the third request."""

    neurons = 3

    def __init__(self, compiled, spec, seed):
        self.calls = 0
        self.fail_at = None

    def step(self, obs, end_ms, budget):
        self.calls += 1
        if self.fail_at == self.calls:
            raise BudgetExceeded("wall time over 1 s")
        ro = {"feed": {"predicted": obs["onFood"], "mean_rate_hz": 12.0, "spikes": 1}, "escape": {"predicted": False, "mean_rate_hz": 0.0, "spikes": 0}}
        return ro, (2 if self.calls > 3 else 0), 10.0


def _serve(lines, head=HEAD, brain=FakeBrain):
    inp = io.StringIO("\n".join([json.dumps(head), *lines]) + "\n")
    out = io.StringIO()
    code = cl.serve(None, None, inp, out, brain=brain)
    return code, [json.loads(x) for x in out.getvalue().splitlines()]


def test_serve_answers_by_id_and_carries_on_after_bad_requests():
    reqs = [
        json.dumps({"id": 1, "t": 0.0, "obs": OBS}),
        "not json",
        json.dumps({"id": 2, "t": 0.01, "obs": {**OBS, "airflow": "fast"}}),
        json.dumps({"id": 3, "t": 0.02, "obs": {**OBS, "onFood": True}}),
        json.dumps({"id": 4, "t": 0.01, "obs": OBS}),  # back in time
        json.dumps({"id": 5, "t": 0.03, "obs": OBS}),
        json.dumps({"bye": True}),
    ]
    code, ans = _serve(reqs)
    assert code == 0 and ans[0]["ready"] and ans[0]["escape_readout"]["name"] == "v1/any"
    assert [a.get("id") for a in ans[1:]] == [1, None, 2, 3, 4, 5]
    assert "readouts" in ans[1] and "error" in ans[2] and "error" in ans[3] and "error" in ans[5]
    assert ans[4]["readouts"]["feed"]["predicted"] is True
    assert ans[6]["readouts"]["escape"] == {"predicted": False, "mean_rate_hz": 0.0, "spikes": 0, "level": 0.0}


def test_serve_stops_with_a_fatal_answer_past_its_budget():
    class Failing(FakeBrain):
        def __init__(self, *a):
            super().__init__(*a)
            self.fail_at = 2

    code, ans = _serve([json.dumps({"id": k, "t": k / 100, "obs": OBS}) for k in range(1, 5)], brain=Failing)
    assert code == 4 and ans[-1]["fatal"] and ans[-1]["id"] == 2 and len(ans) == 3


@pytest.mark.parametrize("head", [{**HEAD, "mode": "neural-shadow"}, {**HEAD, "arm": "baseline"}, {**HEAD, "subject": "eva"}, {**HEAD, "lifeId": "x"}])
def test_serve_refuses_anything_but_a_neural_research_subject(head):
    with pytest.raises(RefusedSubject):
        _serve([], head=head)


def test_integrated_escape_readout_counts_leakily_and_rests():
    r = cl.EscapeReadout({"readout": "integrated", "k": 3, "tau_ms": 50.0, "refractory_s": 1.0})
    fired = [r(t / 100, s, 10.0) for t, s in enumerate([1, 1, 0, 1, 2, 0, 3, 3, 0])]
    # 1, 1.82, 1.49, 2.22 (no), 3.82 -> fires at 0.04 s, then rests until 1.04 s whatever arrives.
    assert fired == [False, False, False, False, True, False, False, False, False]
    assert cl.EscapeReadout({"readout": "any"})(0.0, 1, 10.0) is True


def test_judge_wording_follows_the_production_ratio():
    runs = [
        {"arm": "neural-selected", "scenario": "looms", "summary": {"neural": {"issued_escape": 10, "executed_escape": 6}, "counts": {}, "outcome": {"aborted": False}, "fallbacks": {"fraction": 0.0}}},
    ]
    v = cl.judge({"id": "x", "claim": "", "test": "produced", "arm": "neural-selected", "scenario": "looms", "field_issued": "issued_escape", "field_done": "executed_escape", "min_ratio": 0.9}, runs)
    assert v["ratio"] == 0.6 and not v["passed"] and v["wording"] == "predictive"


def test_parallel_units_then_a_resumed_run_equal_one_process(tmp_path, monkeypatch):
    from pathlib import Path

    cfg = json.loads((Path(cl.__file__).parents[1] / "experiments" / "closed-loop-v783.json").read_text(encoding="utf-8"))
    cfg |= {"arms": ["baseline", "neural-merged"], "scenarios": ["looms", "food"], "seeds": {"dev": [1], "heldout": [2]}}
    cfg["criteria"] = [{"id": "C", "claim": "every neural run completed", "test": "completed"}]
    path = tmp_path / "cfg.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    calls = []

    class Done:
        returncode, stderr = 0, ""

    real = cl.subprocess.run

    def fake_node(cmd, *args, **kw):
        if cmd[0] != "node":
            return real(cmd, *args, **kw)
        cwd = kw["cwd"]
        calls.append(cmd)
        out = Path(cwd) / cmd[cmd.index("--summary") + 1]
        out.write_text(json.dumps({"scenario": cmd[cmd.index("--scenario") + 1], "outcome": {"aborted": False}}), encoding="utf-8")
        return Done()

    monkeypatch.setattr(cl.subprocess, "run", fake_node)
    monkeypatch.setattr(cl, "code_watch", lambda out: type("W", (), {"start": {"commit": "c", "dirty": False, "fly_neural": {"sha256": "s"}}, "__call__": lambda self: {}})())
    with pytest.raises(ValueError, match="no such run"):
        cl.run(path, "dev", tmp_path, tmp_path, tmp_path, "py", log=lambda *_: None, units=["looms:2:baseline"])
    for u in ("looms:1:baseline", "looms:1:neural-merged", "food:1:baseline", "food:1:neural-merged"):
        assert cl.run(path, "dev", tmp_path, tmp_path, tmp_path, "py", log=lambda *_: None, units=[u])["ran"] == [u]
    assert len(calls) == 4
    data = cl.run(path, "dev", tmp_path, tmp_path, tmp_path, "py", log=lambda *_: None, resume=True)
    assert len(calls) == 4 and all(r["resumed"] for r in data["runs"]) and data["failed"] == []
    assert [(r["scenario"], r["arm"]) for r in data["runs"]] == [("looms", "baseline"), ("looms", "neural-merged"), ("food", "baseline"), ("food", "neural-merged")]
    path.write_text(json.dumps(cfg | {"seconds": cfg["seconds"] + 1}), encoding="utf-8")
    cl.run(path, "dev", tmp_path, tmp_path, tmp_path, "py", log=lambda *_: None, resume=True)
    assert len(calls) == 8, "another config must not reuse these runs"
