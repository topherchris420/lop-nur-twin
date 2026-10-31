"""The cloud plans (cloud/plans/*.json) are checked here, before anything is spent on them."""

import importlib.util
import json
from pathlib import Path

import pytest

import fly_neural.__main__ as cli

ROOT = Path(__file__).resolve().parents[1]
PLANS = sorted((ROOT / "cloud" / "plans").rglob("*.json"))
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


def test_split_plans_cover_every_subject_once_then_merge():
    cfg = json.loads((ROOT / "experiments" / "plasticity-v2-v783.json").read_text(encoding="utf-8"))
    p = json.loads((ROOT / "cloud" / "plans" / "plasticity-v2-dev.json").read_text(encoding="utf-8"))
    workers, final = p["phases"]
    only = [c[c.index("--only") + 1] for c in workers["commands"]]
    assert sorted(only) == sorted(a["name"] for a in cfg["arms"])
    assert all("--resume" in c and c[c.index("--split") + 1] == "dev" for c in workers["commands"])
    assert final["commands"][0][-1] == "@progress:plasticity-v2-v783-dev-only-*.jsonl"
    p = json.loads((ROOT / "cloud" / "plans" / "plasticity-v2-heldout.json").read_text(encoding="utf-8"))
    workers, final = p["phases"]
    shards = [c[c.index("--shard") + 1] for c in workers["commands"]]
    n = len(shards)
    assert shards == [f"{i}/{n}" for i in range(n)]
    assert all("--resume" in c and c[c.index("--split") + 1] == "heldout" and "--only" not in c for c in workers["commands"])
    assert final["commands"][0][-1] == f"@progress:plasticity-v2-v783-heldout-shard-*-of-{n}.jsonl"
    assert all(c[c.index("--echo-mb") + 1].endswith("echo-mb-v2-heldout.json") for c in workers["commands"] + final["commands"])


def test_heldout_parts_and_job_one_cover_every_subject_then_judge():
    """The held-out split as it ran: job 1 (plasticity-v2-heldout.json, 32 shards) saved rounds 1-2,
    subjects 0..63 in run order, and was cancelled; the parts ran 64..151, one subject per
    ``--shard k/N``, and ran 31 again as a check that the machines agree."""
    from fly_neural.selective import unit_keys

    cfg = json.loads((ROOT / "experiments" / "plasticity-v2-v783.json").read_text(encoding="utf-8"))
    n = len(unit_keys(cfg, "heldout", cfg["subjects"]["heldout"]))
    job1 = json.loads((ROOT / "cloud" / "plans" / "plasticity-v2-heldout.json").read_text(encoding="utf-8"))
    width = len(job1["phases"][0]["commands"])
    parts_dir = ROOT / "cloud" / "plans" / "plasticity-v2-heldout-parts"
    ks = []
    for path in sorted(parts_dir.glob("plasticity-v2-heldout-p*.json")):
        plan = json.loads(path.read_text(encoding="utf-8"))
        assert plan["name"] == path.stem
        for c in plan["phases"][0]["commands"]:
            assert "--resume" in c and c[c.index("--split") + 1] == "heldout" and "--only" not in c
            k, m = (int(x) for x in c[c.index("--shard") + 1].split("/"))
            assert m == n
            ks.append(k)
    assert sorted(ks) == sorted([31, *range(2 * width, n)])
    assert set(range(2 * width)) | set(ks) == set(range(n))
    judge = json.loads((parts_dir / "plasticity-v2-heldout-judge.json").read_text(encoding="utf-8"))
    assert judge["phases"][0]["commands"][0][-1] == "@progress:plasticity-v2-v783-heldout-shard-*.jsonl"
    assert judge["phases"][0]["ok_exit"] == job1["phases"][1]["ok_exit"]


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


def test_threat_replays_name_real_mappings_and_seeds():
    cfg = json.loads((ROOT / "experiments" / "threat-v783.json").read_text(encoding="utf-8"))
    maps = ["v1"] + [f"v2@{s:g}" for s in cfg["mappings"]["v2"]["candidates"]["size50_deg"]]
    p = json.loads((ROOT / "cloud" / "plans" / "threat-dev.json").read_text(encoding="utf-8"))
    workers, final = p["phases"]
    replays = [c[c.index("--replay") + 1] for c in workers["commands"]]
    assert sorted(replays) == sorted(f"{m}:{s}" for m in maps for s in cfg["seeds"]["dev"])
    assert final["commands"] == [["threat", "run", "--split", "dev", "--resume"]]
    assert {i["to"] for i in p["inputs"]} == {".fly-neural/threat/battery-dev.json", ".fly-neural/threat/recording-dev.jsonl"}
    assert all(len(i["sha256"]) == 64 for i in p["inputs"])


class FakeHub:
    """Stands in for huggingface_hub: a dict of repository paths to bytes."""

    def __init__(self, files: dict[str, bytes]):
        self.files, self.uploads = files, []

    def hf_hub_download(self, repo_id, filename, repo_type, **_):
        p = Path(self.tmp) / "dl" / filename
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(self.files[filename])
        return str(p)

    def snapshot_download(self, repo_id, repo_type, allow_patterns, local_dir):
        import fnmatch

        for name, data in self.files.items():
            if any(fnmatch.fnmatch(name, pat) for pat in allow_patterns):
                p = Path(local_dir) / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(data)

    def HfApi(self):  # noqa: N802 - the real name
        hub = self

        class Api:
            def upload_folder(self, folder_path, path_in_repo, **_):
                hub.uploads.append({str(p.relative_to(folder_path).as_posix()): p.read_bytes() for p in Path(folder_path).rglob("*") if p.is_file()})

        return Api()


def test_the_runner_fetches_restores_runs_and_uploads(tmp_path, monkeypatch):
    import hashlib
    import sys
    import types

    rec = b'{"held": true}\n'
    hub = FakeHub({"inputs/x/recording.jsonl": rec, "c0ffee/p/state/.fly-neural/threat/traces/old.json": b"{}"})
    hub.tmp = tmp_path
    fake = types.ModuleType("huggingface_hub")
    for n in ("hf_hub_download", "snapshot_download", "HfApi"):
        setattr(fake, n, getattr(hub, n))
    monkeypatch.setitem(sys.modules, "huggingface_hub", fake)
    repo = tmp_path / "repo"
    for name, val in (("REPO", repo), ("LOGS", tmp_path / "logs"), ("STAGE", tmp_path / "stage"), ("RESTORE", tmp_path / "restore")):
        monkeypatch.setattr(hf_job, name, val)
    monkeypatch.setattr(hf_job, "sh", lambda *a, **k: "")

    up = hf_job.Uploader("me/runs", "c0ffee/p", [], [".fly-neural/threat/traces"])
    with pytest.raises(SystemExit, match="not"):
        up.fetch_inputs([{"path": "inputs/x/recording.jsonl", "to": ".fly-neural/threat/recording-dev.jsonl", "sha256": "0" * 64}])
    up.fetch_inputs([{"path": "inputs/x/recording.jsonl", "to": ".fly-neural/threat/recording-dev.jsonl", "sha256": hashlib.sha256(rec).hexdigest()}])
    assert (repo / ".fly-neural/threat/recording-dev.jsonl").read_bytes() == rec
    up.restore()
    assert (repo / ".fly-neural/threat/traces/old.json").exists()

    (repo / ".fly-neural/progress").mkdir(parents=True)
    (repo / ".fly-neural/progress/run.jsonl").write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(hf_job, "FLY", ROOT)
    codes = hf_job.run_phase(0, {"commands": [["status"]]}, up)
    assert codes == [0]
    assert (tmp_path / "logs" / "phase0-0.log").read_text(encoding="utf-8").strip()
    last = hub.uploads[-1]
    assert {"state/.fly-neural/progress/run.jsonl", "state/.fly-neural/threat/traces/old.json", "logs/phase0-0.log"} <= set(last)
    assert not any(k.startswith("state/.fly-neural/threat/recording") for k in last)


def test_closed_loop_units_cover_every_run_once_then_judge():
    cfg = json.loads((ROOT / "experiments" / "closed-loop-v783.json").read_text(encoding="utf-8"))
    for split in ("dev", "heldout"):
        p = json.loads((ROOT / "cloud" / "plans" / f"closed-loop-{split}.json").read_text(encoding="utf-8"))
        workers, final = p["phases"]
        units = [c[c.index("--unit") + 1] for c in workers["commands"]]
        assert sorted(units) == sorted(f"{sc}:{s}:{a}" for sc in cfg["scenarios"] for s in cfg["seeds"][split] for a in cfg["arms"])
        assert final["commands"] == [["closedloop", "run", "--split", split, "--resume"]]
        assert p["node"]["version"].startswith("v") and len(p["node"]["sha256"]) == 64


def test_threat_heldout_replays_only_the_merged_and_the_frozen_mapping():
    cfg = json.loads((ROOT / "experiments" / "threat-v783.json").read_text(encoding="utf-8"))
    dev = json.loads((ROOT.parent / "docs" / "benchmarks" / "fly-neural" / "adaptive" / "threat-v783-dev.json").read_text(encoding="utf-8"))
    p = json.loads((ROOT / "cloud" / "plans" / "threat-heldout.json").read_text(encoding="utf-8"))
    workers, final = p["phases"]
    replays = [c[c.index("--replay") + 1] for c in workers["commands"]]
    maps = sorted({"v1", dev["selected"]["mapping"]})
    assert sorted(replays) == sorted(f"{m}:{s}" for m in maps for s in cfg["seeds"]["heldout"])
    assert final["commands"] == [["threat", "run", "--split", "heldout", "--resume"]]
