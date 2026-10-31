"""Runs a plan of fly-neural commands inside a Hugging Face Jobs container.

A person launches it (the command is in docs/ECHO_ADAPTIVE_INTELLIGENCE.md,
"Cloud runs"); nothing in this repository launches it or spends anything.
Inside the job it:

1. requires the checkout to be the commit asked for, with a clean tree;
2. installs fly-neural, fetches the pinned sources onto the job's own disk
   under the terms named in ``FLY_NEURAL_ACCEPT`` (the person launching it
   accepts them), compiles the connectome and prints every array's SHA-256
   so the import can be compared with a local one;
3. restores the plan's progress files from the private results repository
   (``RESULTS_REPO``), so a re-launched job resumes rather than repeats;
4. runs each phase's commands side by side, one process each, uploading
   progress, logs and new results every few minutes and at the end.

FlyWire-derived data never leaves the job: only progress (per-subject
aggregates), logs and sealed results are uploaded, and only to a private
dataset repository. Standard library plus ``huggingface_hub``.

    python fly-neural/cloud/hf_job.py --commit <sha> --plan fly-neural/cloud/plans/<plan>.json
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FLY = REPO / "fly-neural"
LOGS = Path("/work/logs")
STAGE = Path("/work/stage")
UPLOAD_EVERY_S = 600


def sh(*args: str, cwd: Path = REPO) -> str:
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout


def say(msg: str) -> None:
    print(f"[hf-job {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def expand(args: list[str]) -> list[str]:
    """``@progress:<glob>`` becomes one ``--merge-from <file>`` per matching progress file."""
    out: list[str] = []
    for a in args:
        if a.startswith("@progress:"):
            for p in sorted(glob.glob(str(REPO / ".fly-neural" / "progress" / a.split(":", 1)[1]))):
                out += ["--merge-from", p]
        else:
            out.append(a)
    return out


class Uploader:
    def __init__(self, repo_id: str | None, prefix: str, extra: list[str]):
        self.repo_id, self.prefix, self.extra = repo_id, prefix, extra
        self.lock = threading.Lock()
        if repo_id:
            from huggingface_hub import HfApi

            self.api = HfApi()

    def restore(self) -> None:
        if not self.repo_id:
            return
        from huggingface_hub import snapshot_download

        tmp = Path("/work/restore")
        try:
            snapshot_download(self.repo_id, repo_type="dataset", allow_patterns=[f"{self.prefix}/progress/*"], local_dir=tmp)
        except Exception as e:  # noqa: BLE001 - nothing to restore is normal
            say(f"no progress restored ({type(e).__name__})")
            return
        dest = REPO / ".fly-neural" / "progress"
        dest.mkdir(parents=True, exist_ok=True)
        for p in (tmp / self.prefix / "progress").glob("*.jsonl"):
            shutil.copy2(p, dest / p.name)
            say(f"restored {p.name}: {len(p.read_text(encoding='utf-8').splitlines()) - 1} units")

    def push(self, note: str) -> None:
        if not self.repo_id:
            return
        with self.lock:
            if STAGE.exists():
                shutil.rmtree(STAGE)
            (STAGE / "progress").mkdir(parents=True)
            for p in (REPO / ".fly-neural" / "progress").glob("*.jsonl"):
                shutil.copy2(p, STAGE / "progress" / p.name)
            changed = sh("git", "status", "--porcelain", "--untracked-files=all", "--", "docs/benchmarks/fly-neural/adaptive").splitlines()
            for ln in changed:
                rel = ln[3:].strip()
                (STAGE / "results").mkdir(exist_ok=True)
                shutil.copy2(REPO / rel, STAGE / "results" / Path(rel).name)
            if LOGS.exists():
                shutil.copytree(LOGS, STAGE / "logs")
            for d in self.extra:
                if Path(d).exists():
                    shutil.copytree(d, STAGE / "extra" / Path(d).name, dirs_exist_ok=True)
            try:
                self.api.upload_folder(folder_path=str(STAGE), path_in_repo=self.prefix, repo_id=self.repo_id, repo_type="dataset", commit_message=f"{self.prefix}: {note}")
                say(f"uploaded ({note})")
            except Exception as e:  # noqa: BLE001 - an upload failure must not stop the runs
                say(f"upload failed ({type(e).__name__}: {e}); will retry")


def setup(connectome: str, accept: list[str]) -> None:
    sh(sys.executable, "-m", "pip", "install", "-q", "-e", str(FLY), "huggingface_hub>=0.30")
    py = [sys.executable, "-m", "fly_neural"]
    t0 = time.monotonic()
    subprocess.run([*py, "acquire", *sum((["--accept", a] for a in accept), [])], cwd=FLY, check=True)
    say(f"sources fetched and verified in {time.monotonic() - t0:.0f} s")
    sign = connectome.removeprefix("fafb-v783-")
    t0 = time.monotonic()
    subprocess.run([*py, "import", "--sign", sign, "--name", connectome], cwd=FLY, check=True, stdout=subprocess.DEVNULL)
    from fly_neural.acquire import data_dir

    man = json.loads((data_dir() / "compiled" / connectome / "manifest.json").read_text(encoding="utf-8"))
    say(f"compiled {connectome} in {time.monotonic() - t0:.0f} s; arrays: {json.dumps({k: v['sha256'] for k, v in man['files'].items()})}")


def run_phase(i: int, phase: dict, up: Uploader) -> list[int]:
    LOGS.mkdir(parents=True, exist_ok=True)
    procs = []
    t0 = time.monotonic()
    for j, cmd in enumerate(phase["commands"]):
        args = [sys.executable, "-m", "fly_neural", *expand(cmd)]
        log = open(LOGS / f"phase{i}-{j}.log", "w", encoding="utf-8")  # noqa: SIM115 - closed below
        env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
        procs.append((subprocess.Popen(args, cwd=FLY, stdout=log, stderr=subprocess.STDOUT, env=env), log, cmd))
        say(f"phase {i} started {j}: {' '.join(cmd)}")
    last = time.monotonic()
    while any(p.poll() is None for p, _, _ in procs):
        time.sleep(15)
        if time.monotonic() - last > UPLOAD_EVERY_S:
            up.push(f"phase {i} running, {sum(p.poll() is None for p, _, _ in procs)} of {len(procs)} processes")
            last = time.monotonic()
    codes = []
    for j, (p, log, cmd) in enumerate(procs):
        log.close()
        codes.append(p.returncode)
        say(f"phase {i} command {j} exit {p.returncode}: {' '.join(cmd)}")
    say(f"phase {i} took {time.monotonic() - t0:.0f} s")
    up.push(f"phase {i} done, exits {codes}")
    return codes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", required=True)
    ap.add_argument("--plan", required=True)
    a = ap.parse_args()
    head = sh("git", "rev-parse", "HEAD").strip()
    if head != a.commit:
        raise SystemExit(f"checkout is {head}, not {a.commit}")
    if sh("git", "status", "--porcelain", "--untracked-files=all").strip():
        raise SystemExit("the checkout is not clean")
    plan = json.loads((REPO / a.plan).read_text(encoding="utf-8"))
    accept = [t for t in os.environ.get("FLY_NEURAL_ACCEPT", "").split(",") if t]
    os.environ.setdefault("FLY_NEURAL_DATA", "/work/data")
    say(f"plan {plan['name']} at {head[:12]}; cpus {os.cpu_count()}; accepting {accept}")
    setup(plan.get("connectome", "fafb-v783-shiu"), accept)
    if sh("git", "status", "--porcelain", "--untracked-files=all").strip():
        raise SystemExit(f"setup left the tree dirty:\n{sh('git', 'status', '--porcelain')}")
    up = Uploader(os.environ.get("RESULTS_REPO"), f"{head[:12]}/{plan['name']}", plan.get("upload_extra", []))
    up.restore()
    failed = []
    for i, phase in enumerate(plan["phases"]):
        codes = run_phase(i, phase, up)
        failed += [c for c in codes if c not in phase.get("ok_exit", [0])]
        if failed and phase.get("stop_on_failure", True):
            say(f"stopping: phase {i} exits {codes}")
            break
    say("done" if not failed else f"done with failures {failed}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
