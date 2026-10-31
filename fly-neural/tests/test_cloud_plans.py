"""The cloud plans (cloud/plans/*.json) are checked here, before anything is spent on them."""

import importlib.util
import json
from pathlib import Path

import pytest

import fly_neural.__main__ as cli

ROOT = Path(__file__).resolve().parents[1]
PLANS = sorted((ROOT / "cloud" / "plans").glob("*.json"))
spec = importlib.util.spec_from_file_location("hf_job", ROOT / "cloud" / "hf_job.py")
hf_job = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hf_job)


def test_there_are_plans():
    assert {p.stem for p in PLANS} >= {"pilot", "plasticity-v2-dev", "plasticity-v2-heldout"}


@pytest.mark.parametrize("plan", PLANS, ids=lambda p: p.stem)
def test_every_command_parses_and_names_real_arms(plan, monkeypatch):
    seen = []
    for name in ("cmd_selective", "cmd_threat", "cmd_adaptive", "cmd_closedloop", "cmd_mbcode"):
        if hasattr(cli, name):
            monkeypatch.setattr(cli, name, lambda args: seen.append(args) or 0)
    p = json.loads(plan.read_text(encoding="utf-8"))
    cfg = json.loads((ROOT / "experiments" / "plasticity-v2-v783.json").read_text(encoding="utf-8"))
    arms = {a["name"] for a in cfg["arms"]}
    for phase in p["phases"]:
        for cmd in phase["commands"]:
            assert cli.main([a for a in cmd if not a.startswith("@progress:")]) == 0
            args = seen[-1]
            assert set(getattr(args, "only", None) or []) <= arms
            if getattr(args, "echo_mb", None):
                assert (ROOT / args.echo_mb).resolve().is_file(), args.echo_mb


def test_split_plans_cover_every_arm_once_then_merge():
    cfg = json.loads((ROOT / "experiments" / "plasticity-v2-v783.json").read_text(encoding="utf-8"))
    for split in ("dev", "heldout"):
        p = json.loads((ROOT / "cloud" / "plans" / f"plasticity-v2-{split}.json").read_text(encoding="utf-8"))
        workers, final = p["phases"]
        only = [c[c.index("--only") + 1] for c in workers["commands"]]
        assert sorted(only) == sorted(a["name"] for a in cfg["arms"])
        assert all("--resume" in c and c[c.index("--split") + 1] == split for c in workers["commands"])
        assert final["commands"][0][-1] == f"@progress:plasticity-v2-v783-{split}-only-*.jsonl"


def test_progress_tokens_expand_to_merge_options(tmp_path, monkeypatch):
    monkeypatch.setattr(hf_job, "REPO", tmp_path)
    prog = tmp_path / ".fly-neural" / "progress"
    prog.mkdir(parents=True)
    for n in ("x-dev-only-v2.jsonl", "x-dev-only-fixed.jsonl", "x-dev.jsonl"):
        (prog / n).write_text("{}\n", encoding="utf-8")
    out = hf_job.expand(["selective", "run", "@progress:x-dev-only-*.jsonl"])
    assert out[:2] == ["selective", "run"]
    assert out[2::2] == ["--merge-from", "--merge-from"]
    assert sorted(Path(x).name for x in out[3::2]) == ["x-dev-only-fixed.jsonl", "x-dev-only-v2.jsonl"]
