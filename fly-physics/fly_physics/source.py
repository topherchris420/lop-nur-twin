"""FlyBody's code and model, fetched by git at the pinned commit and checked.

The commit is the one the browser's anatomy was imported from: it is read
from src/bethesda/fly/data/flybody.source.json, never written here, so the
physics and the drawing cannot drift apart. Before anything imports FlyBody,
`verify` requires the checkout to be exactly that commit with no local
changes, and every file the importer read (the MJCF and its meshes) to hash to
the manifest's SHA-256. The importer ran on a checkout with CRLF line endings,
so a text file also matches when its LF form, converted to CRLF, does; which
form matched is recorded.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST = REPO_ROOT / "src" / "bethesda" / "fly" / "data" / "flybody.source.json"
DEFAULT_CACHE = REPO_ROOT / ".fly-physics" / "flybody"


class FlyBodySourceError(RuntimeError):
    """The checkout is missing, at another commit, changed, or its files differ."""


def pinned() -> dict:
    """The repository, commit and input hashes the browser's anatomy came from."""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("schema") != "flybody-source/v1":
        raise FlyBodySourceError(f"{MANIFEST} is not a flybody-source/v1 manifest")
    commit = manifest["commit"]
    if not (isinstance(commit, str) and len(commit) == 40):
        raise FlyBodySourceError("the manifest names no full commit")
    return {
        "repository": manifest["repository"],
        "url": manifest["repositoryUrl"],
        "commit": commit,
        "license": manifest["license"],
        "inputs": manifest["inputs"],
    }


def _git(cache: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(cache), *args],
        check=True,
        capture_output=True,
        text=True,
        timeout=600,
    ).stdout.strip()


def fetch(cache: Path = DEFAULT_CACHE) -> None:
    """Clone FlyBody into `cache` (if absent) and check out the pinned commit, detached."""
    pin = pinned()
    if not (cache / ".git").exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--no-checkout", pin["url"], str(cache)],
            check=True,
            timeout=600,
        )
    _git(cache, "checkout", "--detach", pin["commit"])


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def match(data: bytes, expected: str) -> str | None:
    """ "exact" when the bytes hash to `expected`; "crlf" when a text file does once
    its line endings are CRLF, as the importer read them; otherwise None."""
    if _sha256(data) == expected:
        return "exact"
    if b"\0" not in data:
        as_crlf = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        if _sha256(as_crlf) == expected:
            return "crlf"
    return None


def verify(cache: Path = DEFAULT_CACHE) -> dict:
    """Check the checkout against the pin; return what was checked, or raise."""
    pin = pinned()
    if not (cache / ".git").exists():
        raise FlyBodySourceError(
            f"no FlyBody checkout at {cache}; run `python -m fly_physics setup`"
        )
    head = _git(cache, "rev-parse", "HEAD")
    if head != pin["commit"]:
        raise FlyBodySourceError(f"{cache} is at {head}, not the pinned {pin['commit']}")
    status = _git(cache, "status", "--porcelain", "--untracked-files=all")
    if status:
        raise FlyBodySourceError(f"{cache} has local changes:\n{status}")
    exact = crlf = 0
    for item in pin["inputs"]:
        path = cache / item["path"]
        if not path.is_file():
            raise FlyBodySourceError(f"{item['path']} is missing from the checkout")
        how = match(path.read_bytes(), item["sha256"])
        if how is None:
            raise FlyBodySourceError(f"{item['path']} differs from the file the importer read")
        exact += how == "exact"
        crlf += how == "crlf"
    return {
        "repository": pin["repository"],
        "url": pin["url"],
        "commit": head,
        "license": pin["license"],
        "inputs_checked": exact + crlf,
        "inputs_byte_identical": exact,
        "inputs_identical_as_crlf": crlf,
    }


def import_flybody(cache: Path = DEFAULT_CACHE) -> dict:
    """Verify the checkout, then import FlyBody from it (and from nowhere else)."""
    checked = verify(cache)
    root = str(cache.resolve())
    if root not in sys.path:
        sys.path.insert(0, root)
    import flybody

    where = Path(flybody.__file__).resolve()
    if cache.resolve() not in where.parents:
        raise FlyBodySourceError(
            f"flybody was imported from {where}, not from the verified checkout {cache}; "
            "uninstall any other flybody from this environment"
        )
    return checked
