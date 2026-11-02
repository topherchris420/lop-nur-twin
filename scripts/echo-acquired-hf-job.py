"""Runs part of the acquired-search study inside a Hugging Face Jobs container.

A person launches it (the command is in docs/ECHO_ACQUIRED_BEHAVIOR.md); nothing
in this repository launches it or spends anything. Research flies only: it reads
no store and no archive. It takes the public repository at ``COMMIT``, lays
uncommitted code over it from a bundle checked by SHA-256 if ``BUNDLE_SHA256``
is set (a development run only; a held-out run has no bundle), installs Node.js
and the locked npm dependencies without install scripts, and runs each stream
of ``STREAMS_JSON`` side by side, ``@OUT@`` in a stream's arguments becoming its
own results file. Each finished fly's line and the logs go to ``RESULTS_REPO``,
a private dataset, every few minutes and at the end, so a stopped job keeps what
it finished. Standard library plus ``huggingface_hub``.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download

REPO_ID = os.environ["RESULTS_REPO"]
PREFIX = os.environ["RUN_PREFIX"]
PART = os.environ["JOB_PART"]
COMMIT = os.environ["COMMIT"]
BUNDLE_SHA = os.environ.get("BUNDLE_SHA256")
STREAMS = json.loads(os.environ["STREAMS_JSON"])
NODE = "v24.22.1"
NODE_SHA = "6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6"
WORK = Path("/work")
REPO = WORK / "repo"
OUT = WORK / "out"
UPLOAD_EVERY_S = 300


def say(msg: str) -> None:
    print(f"[acquired {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def run(*args: str, cwd: Path | None = None, env: dict | None = None) -> str:
    return subprocess.run(args, cwd=cwd, env=env, check=True, capture_output=True, text=True).stdout


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    api = HfApi()
    lock = threading.Lock()

    def upload(note: str) -> None:
        with lock:
            try:
                api.upload_folder(
                    repo_id=REPO_ID,
                    repo_type="dataset",
                    folder_path=str(OUT),
                    path_in_repo=f"{PREFIX}/results/part{PART}",
                    commit_message=f"{PREFIX} part {PART}: {note}",
                )
                say(f"uploaded ({note})")
            except Exception as e:  # noqa: BLE001 - the next upload tries again
                say(f"upload failed ({type(e).__name__})")

    REPO.mkdir(parents=True)
    run("git", "init", "-q", cwd=REPO)
    run("git", "remote", "add", "origin", "https://github.com/topherchris420/lop-nur-twin.git", cwd=REPO)
    run("git", "fetch", "-q", "--depth", "1", "origin", COMMIT, cwd=REPO)
    run("git", "checkout", "-q", "FETCH_HEAD", cwd=REPO)
    head = run("git", "rev-parse", "HEAD", cwd=REPO).strip()
    if head != COMMIT:
        raise SystemExit(f"checkout is {head}, not {COMMIT}")

    if BUNDLE_SHA:
        bundle = Path(hf_hub_download(REPO_ID, f"{PREFIX}/bundle.tar.gz", repo_type="dataset"))
        if sha256(bundle) != BUNDLE_SHA:
            raise SystemExit(f"bundle is {sha256(bundle)}, not {BUNDLE_SHA}")
        with tarfile.open(bundle) as tar:
            tar.extractall(REPO, filter="data")
        say(f"code laid over {COMMIT[:12]}:\n{run('git', 'status', '--short', cwd=REPO)}")

    name = f"node-{NODE}-linux-x64"
    tarball = WORK / f"{name}.tar.xz"
    urllib.request.urlretrieve(f"https://nodejs.org/dist/{NODE}/{name}.tar.xz", tarball)
    if sha256(tarball) != NODE_SHA:
        raise SystemExit(f"{tarball.name} is {sha256(tarball)}, not {NODE_SHA}")
    run("tar", "-xJf", str(tarball), "-C", str(WORK))
    env = {**os.environ, "PATH": f"{WORK / name / 'bin'}:{os.environ['PATH']}"}
    run("npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund", cwd=REPO, env=env)
    version = run("node", "--version", env=env).strip()
    say(f"node {version} on {platform.machine()}, {os.cpu_count()} CPUs")

    record = {
        "commit": COMMIT,
        "bundleSha256": BUNDLE_SHA,
        "node": version,
        "machine": platform.machine(),
        "part": PART,
        "streams": STREAMS,
        "startedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (OUT / "record.json").write_text(json.dumps(record, indent=2) + "\n")

    procs = []
    for i, args in enumerate(STREAMS):
        log = open(OUT / f"s{i}.log", "w")
        args = [a.replace("@OUT@", str(OUT / f"s{i}.jsonl")) for a in args]
        procs.append(subprocess.Popen(args, cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT))
    say(f"{len(procs)} streams running")

    finished = threading.Event()

    def uploads() -> None:
        while not finished.wait(UPLOAD_EVERY_S):
            upload("progress")

    threading.Thread(target=uploads, daemon=True).start()
    codes = [p.wait() for p in procs]
    finished.set()
    record |= {
        "exitCodes": codes,
        "finishedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (OUT / "record.json").write_text(json.dumps(record, indent=2) + "\n")
    (OUT / "done.json").write_text(json.dumps({"exitCodes": codes}) + "\n")
    for _ in range(4):
        upload("final")
        names = {
            f.split("/")[-1]
            for f in api.list_repo_files(REPO_ID, repo_type="dataset")
            if f.startswith(f"{PREFIX}/results/part{PART}/")
        }
        if "done.json" in names:
            break
        time.sleep(30)
    say(f"exit codes {codes}")
    return 0 if all(c == 0 for c in codes) else 1


if __name__ == "__main__":
    sys.exit(main())
