"""Sealed records: canonical JSON with its own SHA-256, the code that wrote it, the environment.

The conventions follow fly-physics (fly-physics/fly_physics/report.py): a
record's ``sha256`` is over the rest of it as canonical JSON (sorted keys, no
spaces, UTF-8), and it names the repository commit, whether the tree differed
from it, and the digest of this package's own source files.
"""

from __future__ import annotations

import hashlib
import json
import platform
import subprocess
import sys
from importlib import metadata
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent
REPO = PACKAGE.parents[1]


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sealed(body: dict) -> dict:
    body = {k: v for k, v in body.items() if k != "sha256"}
    return {**body, "sha256": hashlib.sha256(canonical(body).encode("utf-8")).hexdigest()}


def check_seal(data: dict) -> bool:
    return sealed(data)["sha256"] == data.get("sha256")


def source_digest() -> dict:
    """SHA-256 over this package's Python sources (path and bytes, LF-normalised)."""
    h = hashlib.sha256()
    files = sorted(p for p in PACKAGE.rglob("*.py") if "__pycache__" not in p.parts)
    for p in files:
        h.update(p.relative_to(PACKAGE).as_posix().encode())
        h.update(b"\0")
        h.update(p.read_bytes().replace(b"\r\n", b"\n"))
        h.update(b"\0")
    return {"sha256": h.hexdigest(), "files": len(files)}


def environment() -> dict:
    def version(dist: str) -> str | None:
        try:
            return metadata.version(dist)
        except metadata.PackageNotFoundError:
            return None

    return {
        "python": platform.python_version(),
        "implementation": sys.implementation.name,
        "platform": f"{sys.platform} {platform.machine()}",
        "processor": platform.processor() or None,
        "numpy": version("numpy"),
        "scipy": version("scipy"),
        "polars": version("polars"),
        "brian2": version("brian2"),
    }


def code_state(results: Path | None = None) -> dict:
    """This repository's commit and whether anything but ``results`` differs from it.

    Unknown (no git) is null, never guessed."""

    def git(*args: str) -> str | None:
        try:
            return subprocess.run(
                ["git", "-C", str(REPO), *args], check=True, capture_output=True, text=True, timeout=60
            ).stdout
        except (OSError, subprocess.SubprocessError):
            return None

    commit = git("rev-parse", "HEAD")
    status = git("status", "--porcelain", "--untracked-files=all")
    skip = None
    if results is not None:
        try:
            skip = results.resolve().relative_to(REPO.resolve()).as_posix() + "/"
        except ValueError:
            skip = None
    changed = None if status is None else [ln for ln in status.splitlines() if not (skip and ln[3:].startswith(skip))]
    return {
        "commit": commit.strip() if commit else None,
        "dirty": None if changed is None else bool(changed),
        "fly_neural": source_digest(),
    }


def code_watch(results: Path | None = None):
    """Take the code state now; the returned function gives it back at the end of a run.

    A result records the code its run started with. If the commit, the tree's
    cleanliness or this package's source changed before the run finished,
    ``changed_during_run`` names what changed."""
    start = code_state(results)

    def finish() -> dict:
        end = code_state(results)
        return {**start, "changed_during_run": [k for k in ("commit", "dirty", "fly_neural") if start.get(k) != end.get(k)]}

    finish.start = start
    return finish


def write_json(path: Path, data: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return path


def load_sealed(path: Path, schema: str) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != schema:
        raise ValueError(f"{path} is {data.get('schema')!r}, not {schema}")
    if not check_seal(data):
        raise ValueError(f"{path} does not match its own sha256")
    return data
