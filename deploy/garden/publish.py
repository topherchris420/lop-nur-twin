#!/usr/bin/env python3
"""Publish a garden release to the live garden's web root, and keep its life.

Runs on the garden's server, as root, on a release that `deploy.mjs publish`
staged there (a directory built by `bun run garden:build`):

    sudo python3 publish.py STAGE --expect-index SHA256
    sudo python3 publish.py --rollback RELEASE

Publishing changes files under the web root and nothing else: it restarts no
service and never opens the life's database. In order, it

  1. refuses unless the garden's own backup unit has saved the life recently
     (its last run succeeded and its newest snapshot is fresh);
  2. checks every staged file against the release's manifest;
  3. refuses unless the live index is the one inspected (--expect-index), so a
     page someone else published is never replaced unseen;
  4. saves that index under /var/backups/bethesda-fly-ui/RELEASE/;
  5. installs the release in its own directory beside the earlier ones (they
     stay, so a page already open keeps its files) and swaps index.html last;
  6. checks that the web server serves exactly the release's bytes, and that
     the same life, by identity and birth, runs in the same process with a
     journal no shorter than before.

If a check after the swap fails, the saved index goes back and the result says
so. --rollback puts a release's saved index back, with the same checks.

It prints one JSON object and exits 0 only when everything checked.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen

RELEASE = re.compile(r"^garden-\d{8}-[0-9a-f]{12}$")
# Relative paths of plain names: no absolute paths, no "..", no hidden files.
FILE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]*(/[A-Za-z0-9_][A-Za-z0-9._-]*)*$")
# Pages this site has published, as their index refers to them.
PAGE_DIR = re.compile(r'(?:src|href)="/((?:ui|garden)-\d{8}-[0-9a-f]{12})/([^"?#]+)"')


class Refused(Exception):
    """Stopped before the live index was touched."""


class Failed(Exception):
    """A check after the swap failed, and the previous index was put back."""


def before_swap(step):
    """Runs a step before the swap: any failure in it leaves the live page as it was."""
    try:
        return step()
    except Refused:
        raise
    except Exception as e:
        raise Refused(f"{type(e).__name__}: {e}") from e


def swapped(root: Path, html: bytes, previous: bytes, checks):
    """Puts html in as the index, runs the checks, and puts previous back if one fails."""
    put_index(root, html)
    try:
        return checks()
    except Exception as e:
        put_index(root, previous)
        raise Failed(f"{type(e).__name__}: {e}") from e


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def systemctl_show(unit: str, prop: str) -> str:
    return subprocess.check_output(
        ["systemctl", "show", unit, f"--property={prop}", "--value"], text=True
    ).strip()


def get(url: str) -> tuple[int, dict, bytes]:
    request = Request(url, headers={"Accept-Encoding": "identity", "Cache-Control": "no-cache"})
    with urlopen(request, timeout=5) as response:
        return response.status, dict(response.headers), response.read()


def life(args) -> dict:
    status, _, body = get(args.state)
    if status != 200:
        raise Refused(f"the garden's state answered HTTP {status}")
    state = json.loads(body)
    return {k: state.get(k) for k in ("life_id", "born_at", "moments_count", "ticks")}


def fresh_backup(args, show, now) -> dict:
    result = show(args.backup_unit, "Result")
    if result != "success":
        raise Refused(f"{args.backup_unit} last ended with {result!r}: run it and check it")
    snapshots = sorted(Path(args.life_backups).glob("day-*.sqlite3"), key=lambda p: p.stat().st_mtime)
    if not snapshots:
        raise Refused(f"no saved life in {args.life_backups}: run {args.backup_unit} first")
    age = now() - snapshots[-1].stat().st_mtime
    if age > args.backup_max_age:
        raise Refused(
            f"the newest saved life ({snapshots[-1].name}) is {age / 60:.0f} min old: "
            f"run {args.backup_unit} first"
        )
    return {"snapshot": str(snapshots[-1]), "age_s": round(age)}


def staged(stage: Path) -> tuple[str, dict]:
    """The release's name and every file to install, each checked against the manifest."""
    manifest = json.loads((stage / "manifest.json").read_bytes())
    release = manifest.get("release", "")
    if not RELEASE.match(release):
        raise Refused(f"not a garden release name: {release!r}")
    listed = manifest.get("sha256") or {}
    files = {}
    for rel, digest in listed.items():
        if not FILE.match(rel) or rel == "manifest.json":
            raise Refused(f"the manifest lists an unexpected path: {rel!r}")
        data = (stage / rel).read_bytes()
        if sha256(data) != digest:
            raise Refused(f"{rel} does not match the manifest")
        files[rel] = data
    if "index.html" not in files:
        raise Refused("the release has no index.html")
    for path in sorted(stage.rglob("*")):
        rel = path.relative_to(stage).as_posix()
        if path.is_symlink():
            raise Refused(f"{rel} is a link")
        if path.is_dir() or rel in files or rel == "manifest.json":
            continue
        # A compressed twin, for gzip_static, must be its original exactly.
        if rel.endswith(".gz") and rel[:-3] in listed:
            data = path.read_bytes()
            if gzip.decompress(data) != files[rel[:-3]]:
                raise Refused(f"{rel} is not {rel[:-3]} compressed")
            files[rel] = data
            continue
        raise Refused(f"{rel} is not in the manifest")
    files["manifest.json"] = (stage / "manifest.json").read_bytes()
    return release, files


def install(root: Path, release: str, files: dict) -> bool:
    """Puts the release beside the earlier ones; False when it is already there, byte for byte."""
    target = root / release
    if target.exists():
        for rel, data in files.items():
            if not (target / rel).is_file() or (target / rel).read_bytes() != data:
                raise Refused(f"{target} exists with other files")
        return False
    # Assembled outside the web root, then renamed into it whole.
    partial = root.parent / f".{release}.partial"
    if partial.exists():
        shutil.rmtree(partial)  # this script's own, from a run that stopped
    for rel, data in files.items():
        path = partial / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(0o644)
    for d in [partial, *(p for p in partial.rglob("*") if p.is_dir())]:
        d.chmod(0o755)
    os.rename(partial, target)
    return True


def put_index(root: Path, html: bytes) -> None:
    nxt = root / "index.html.next"
    nxt.write_bytes(html)
    nxt.chmod(0o644)
    os.replace(nxt, root / "index.html")


def check_served(args, paths: dict) -> dict:
    """Every path is served as these exact bytes; returns the page's response headers."""
    page = {}
    for url_path, data in paths.items():
        status, headers, body = get(args.origin + url_path)
        if status != 200 or body != data:
            raise Failed(f"{url_path} is not served as published (HTTP {status})")
        if url_path == "/":
            page = headers
    return page


def check_life(args, show, before: dict, pid: str) -> dict:
    after = life(args)
    if (after["life_id"], after["born_at"]) != (before["life_id"], before["born_at"]):
        raise Failed(f"the life changed: {before['life_id']} became {after['life_id']}")
    if (after["moments_count"] or 0) < (before["moments_count"] or 0):
        raise Failed("the life's journal is shorter than before")
    now_pid = show(args.service, "MainPID")
    if now_pid != pid:
        raise Failed(f"{args.service} changed process ({pid} became {now_pid})")
    return after


def publish(args, show, now) -> dict:
    root = Path(args.root)

    def prepare():
        backup = fresh_backup(args, show, now)
        release, files = staged(Path(args.stage))
        current = (root / "index.html").read_bytes()
        if sha256(current) != args.expect_index:
            raise Refused("the live index changed since it was inspected; inspect it again")
        before = life(args)
        pid = show(args.service, "MainPID")
        if pid in ("", "0"):
            raise Refused(f"{args.service} is not running")
        saved = Path(args.saved) / release
        if (saved / "index.html").exists():
            # Published before and rolled back: the page it replaces must be the same one.
            if (saved / "index.html").read_bytes() != current:
                raise Refused(f"{saved} holds another page; it is not overwritten")
        else:
            saved.mkdir(parents=True, mode=0o700)
            shutil.copy2(root / "index.html", saved / "index.html")
        installed = install(root, release, files)
        return backup, release, files, current, before, pid, saved, installed

    backup, release, files, current, before, pid, saved, installed = before_swap(prepare)

    def checks():
        paths = {"/": files["index.html"]}
        paths.update({f"/{release}/{rel}": data for rel, data in files.items()})
        return check_served(args, paths), check_life(args, show, before, pid)

    headers, after = swapped(root, files["index.html"], current, checks)
    (saved / "publish.json").write_text(
        json.dumps(
            {
                "release": release,
                "replaced_index_sha256": sha256(current),
                "published_at": now(),
            }
        )
        + "\n"
    )
    return {
        "ok": True,
        "release": release,
        "installed": installed,
        "files": len(files),
        "index_sha256": sha256(files["index.html"]),
        "replaced_index_sha256": sha256(current),
        "saved_index": str(saved / "index.html"),
        "life_backup": backup,
        "life_id": after["life_id"],
        "born_at": after["born_at"],
        "moments": [before["moments_count"], after["moments_count"]],
        "ticks": [before["ticks"], after["ticks"]],
        "service_pid": pid,
        "service_restarted": False,
        "content_security_policy": headers.get("Content-Security-Policy"),
    }


def rollback(args, show) -> dict:
    root = Path(args.root)

    def prepare():
        if not RELEASE.match(args.rollback):
            raise Refused(f"not a garden release name: {args.rollback!r}")
        saved = Path(args.saved) / args.rollback / "index.html"
        if not saved.exists():
            raise Refused(f"no saved page for {args.rollback}")
        html = saved.read_bytes()
        # The saved page's own files must still be there.
        needed = {
            f"/{d}/{rel}": (root / d / rel).read_bytes()
            for d, rel in PAGE_DIR.findall(html.decode())
        }
        current = (root / "index.html").read_bytes()
        return html, needed, current, life(args), show(args.service, "MainPID")

    html, needed, current, before, pid = before_swap(prepare)
    _, after = swapped(
        root,
        html,
        current,
        lambda: (check_served(args, {"/": html, **needed}), check_life(args, show, before, pid)),
    )
    return {
        "ok": True,
        "rolled_back": args.rollback,
        "index_sha256": sha256(html),
        "life_id": after["life_id"],
        "born_at": after["born_at"],
        "service_pid": pid,
        "service_restarted": False,
    }


def main(argv=None, show=systemctl_show, now=time.time) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("stage", nargs="?", help="the staged release directory")
    parser.add_argument("--expect-index", help="SHA-256 of the live index.html, as inspected")
    parser.add_argument("--rollback", metavar="RELEASE", help="put back the page RELEASE replaced")
    parser.add_argument("--root", default="/var/www/bethesda-fly")
    parser.add_argument("--saved", default="/var/backups/bethesda-fly-ui")
    parser.add_argument("--life-backups", default="/var/lib/bethesda-fly/backups")
    parser.add_argument("--backup-unit", default="bethesda-fly-backup.service")
    parser.add_argument("--backup-max-age", type=float, default=1800, help="seconds")
    parser.add_argument("--service", default="bethesda-fly")
    parser.add_argument("--origin", default="http://127.0.0.1")
    parser.add_argument("--state", default="http://127.0.0.1:8765/state")
    args = parser.parse_args(argv)
    try:
        if args.rollback:
            result = rollback(args, show)
        elif args.stage and args.expect_index:
            result = publish(args, show, now)
        else:
            parser.error("give STAGE --expect-index SHA256, or --rollback RELEASE")
    except Refused as e:
        print(json.dumps({"ok": False, "live_index_changed": False, "error": str(e)}))
        return 2
    except Failed as e:
        print(json.dumps({"ok": False, "live_index_changed": False, "restored_previous_index": True, "error": str(e)}))
        return 1
    except Exception as e:  # putting the previous index back failed: look at the server
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}", "inspect": "the live index"}))
        return 3
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
