#!/usr/bin/env python3
"""Checks that a copy of Eva's life would resume as her, without resuming it.

  python -I scripts/eva-restore-check.py DATABASE [SIDECAR] [--expect-life ID] [--mode MODE]

DATABASE is a SQLite snapshot her backup made (`node deploy/garden/deploy.mjs
backup`); SIDECAR is a copy of her plasticity file (`eva.eva-plasticity-v1.json`),
copied before the snapshot was taken (her extension refuses a sidecar that has
learned past her tick). The check follows her service's own load path
(`World.__init__` in deploy/garden/service/server.py) as far as it goes without
writing or advancing her clock:

  1. the database's integrity (`PRAGMA integrity_check`) and its world row;
  2. `learning.initialize` on that state, as on every start;
  3. `Plasticity.bind`, her extension's own restart gate: the same life and
     birth, a sidecar not ahead of her tick, the mode she runs in.

It never saves, never calls `advance`, and works on throwaway copies (SQLite
writes -wal and -shm files beside a database it opens), so the copies it is
given stay byte for byte. A copy that stepped forward would be a second Eva.
Prints a JSON record; exits 1 if the copy would not resume as her, 2 on misuse.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

SERVICE = Path(__file__).resolve().parent.parent / "deploy" / "garden" / "service"
sys.path.insert(0, str(SERVICE))

import eva_plasticity  # noqa: E402
import learning  # noqa: E402


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check(database: Path, sidecar: Path | None, expect_life: str | None, mode: str) -> dict:
    record: dict = {
        "schema": "eva-restore-check/v1",
        "database": {"file": database.name, "bytes": database.stat().st_size, "sha256": sha256(database)},
        "sidecar": None,
        "problems": [],
    }
    work = Path(tempfile.mkdtemp(prefix="eva-restore-check-"))
    try:
        db = work / "world.sqlite3"
        shutil.copyfile(database, db)
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
            row = con.execute("SELECT value FROM world WHERE id=1").fetchone()
            moments = con.execute("SELECT COUNT(*), MAX(at) FROM moments").fetchone()
        finally:
            con.close()
        record["database"]["integrity"] = integrity
        if integrity != "ok":
            record["problems"].append(f"integrity_check: {integrity}")
        if row is None:
            record["problems"].append("no world row: her service would begin a new life here")
            return record
        state = json.loads(row[0])
        learning.initialize(state)
        record["life"] = {
            "life_id": state.get("life_id"),
            "born_at": state.get("born_at"),
            "ticks": state.get("ticks"),
            "updated_at": state.get("updated_at"),
            "place": state.get("place"),
            "activity": state.get("activity"),
            "journeys": state.get("journeys"),
            "moments": moments[0],
            "last_moment_at": moments[1],
        }
        if expect_life is not None and state.get("life_id") != expect_life:
            record["problems"].append(f"life {state.get('life_id')!r} is not {expect_life!r}")

        if sidecar is None:
            record["problems"].append("no sidecar: her plasticity would begin afresh")
            return record
        kept = work / ("eva" + eva_plasticity.SIDECAR_SUFFIX)
        shutil.copyfile(sidecar, kept)
        record["sidecar"] = {"file": sidecar.name, "bytes": sidecar.stat().st_size, "sha256": sha256(sidecar)}
        plasticity = eva_plasticity.Plasticity(mode, kept, db)
        plasticity.bind(state)
        if plasticity.problem is not None:
            record["problems"].append(f"her extension would refuse it: {plasticity.problem}")
            return record
        s = plasticity.state
        record["sidecar"].update(
            {
                "schema": s["schema"],
                "mode": s["mode"],
                "mode_changed_by_restore": plasticity.dirty,
                "last_tick": s["last_tick"],
                "ticks_behind_her": state["ticks"] - s["last_tick"] if s["last_tick"] is not None else None,
                "estimates": len(s["stats"]),
                "samples": s["samples"],
                "overrides": s["overrides"],
                "would_override": s["would_override"],
            }
        )
        if plasticity.dirty:
            record["problems"].append(f"the sidecar's mode is {s['mode_history'][-1]['from']!r}, not {mode!r}")
        return record
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main(argv: list[str]) -> int:
    args, expect_life, mode = [], None, "active"
    it = iter(argv)
    for a in it:
        if a == "--expect-life":
            expect_life = next(it, None)
        elif a == "--mode":
            mode = next(it, "")
        elif a.startswith("--"):
            print(f"unknown option {a}", file=sys.stderr)
            return 2
        else:
            args.append(Path(a))
    if not 1 <= len(args) <= 2 or mode not in eva_plasticity.MODES or (expect_life == ""):
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    record = check(args[0], args[1] if len(args) == 2 else None, expect_life, mode)
    record["resumes"] = not record["problems"]
    print(json.dumps(record, indent=2))
    return 0 if record["resumes"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
