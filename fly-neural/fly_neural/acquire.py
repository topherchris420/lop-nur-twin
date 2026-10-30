"""Fetch and verify the pinned source files into a local cache outside the repository.

The cache is ``$FLY_NEURAL_DATA`` or ``~/.cache/fly-neural``. A file is fetched
only when the caller names the terms it is offered under (``accept``), is
streamed to a ``.part`` file in 1 MiB chunks (resumed if a previous fetch broke
off), and is moved into place only if its size and SHA-256 match the manifest.
This module is the only one that touches the network.
"""

from __future__ import annotations

import hashlib
import os
import urllib.request
from pathlib import Path

from .sources import BY_KEY, SOURCES, TERMS, Source

CHUNK = 1 << 20


class SourceError(RuntimeError):
    pass


def data_dir() -> Path:
    env = os.environ.get("FLY_NEURAL_DATA")
    return Path(env).expanduser() if env else Path.home() / ".cache" / "fly-neural"


def path_of(key: str, root: Path | None = None) -> Path:
    s = BY_KEY[key]
    return (root or data_dir()) / s.group / s.filename


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def verify(key: str, root: Path | None = None) -> Path:
    """The verified path of a source, or SourceError saying what is wrong."""
    s = BY_KEY[key]
    p = path_of(key, root)
    if not p.is_file():
        raise SourceError(
            f"{s.group}/{s.filename} is missing; fetch it with "
            f"`python -m fly_neural acquire --accept {s.terms}` ({TERMS[s.terms]})"
        )
    if p.stat().st_size != s.size:
        raise SourceError(f"{p} has {p.stat().st_size} bytes, the manifest says {s.size}")
    digest = sha256_file(p)
    if digest != s.sha256:
        raise SourceError(f"{p} has SHA-256 {digest}, the manifest says {s.sha256}")
    return p


def status(root: Path | None = None) -> list[dict]:
    rows = []
    for s in SOURCES:
        try:
            verify(s.key, root)
            state = "verified"
        except SourceError as e:
            state = "missing" if "missing" in str(e) else f"bad: {e}"
        rows.append({"key": s.key, "file": f"{s.group}/{s.filename}", "state": state, "terms": s.terms})
    return rows


def fetch(s: Source, root: Path, *, timeout: float = 60.0) -> Path:
    dest = root / s.group / s.filename
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    if have > s.size:
        part.unlink()
        have = 0
    req = urllib.request.Request(s.url, headers={"User-Agent": "fly-neural/1 (research import)"})
    if have:
        req.add_header("Range", f"bytes={have}-")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - pinned https URL
        if have and resp.status != 206:
            have = 0  # the server ignored the range: start over
        with part.open("ab" if have else "wb") as out:
            for block in iter(lambda: resp.read(CHUNK), b""):
                out.write(block)
    if part.stat().st_size != s.size:
        raise SourceError(f"{s.filename}: got {part.stat().st_size} bytes, expected {s.size}; rerun to resume")
    digest = sha256_file(part)
    if digest != s.sha256:
        part.unlink()
        raise SourceError(f"{s.filename}: SHA-256 {digest} does not match the manifest; the partial file was deleted")
    part.replace(dest)
    return dest


def acquire(keys: list[str] | None, accept: set[str], root: Path | None = None) -> list[dict]:
    root = root or data_dir()
    wanted = [BY_KEY[k] for k in keys] if keys else [s for s in SOURCES]
    report = []
    for s in wanted:
        try:
            verify(s.key, root)
            report.append({"key": s.key, "action": "already verified"})
            continue
        except SourceError:
            pass
        if s.terms not in accept:
            report.append({"key": s.key, "action": f"skipped: pass --accept {s.terms} ({TERMS[s.terms]})"})
            continue
        fetch(s, root)
        report.append({"key": s.key, "action": "fetched and verified"})
    return report
