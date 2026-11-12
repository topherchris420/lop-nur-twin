"""Tests for scripts/eva-restore-check.py on research gardens only.

Every life here is born in a temporary directory by her original service and
run by her patched service, as in deploy/garden/service/study.py. Never Eva,
never a copy of her database, no network.

  cd scripts && python -m unittest test_eva_restore_check -v
"""

from __future__ import annotations

import hashlib
import importlib.util
import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVICE = HERE.parent / "deploy" / "garden" / "service"
sys.path.insert(0, str(SERVICE))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


study = _load("eva_study_for_restore_check", SERVICE / "study.py")
restore = _load("eva_restore_check", HERE / "eva-restore-check.py")
eva_plasticity = study.eva_plasticity


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot(db: Path, into: Path) -> Path:
    """What deploy/garden/service/backup.py does: a consistent SQLite copy."""
    source = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    target = sqlite3.connect(str(into))
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    return into


class RestoreCheck(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="eva-restore-test-"))
        self.db = study.birth(self.dir, 9101, "autumn")
        self.sidecar = self.dir / ("eva" + eva_plasticity.SIDECAR_SUFFIX)
        self.plasticity = eva_plasticity.Plasticity("active", self.sidecar, self.db)
        self.t = study.start_of("autumn")
        self.world = study.make(study.patched, self.db, self.t, self.plasticity)
        self.copies = self.dir / "copies"
        self.copies.mkdir()

    def tearDown(self):
        self.world.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def live(self, seconds: float):
        end = self.t + seconds
        while self.t + 5 <= end:
            self.t += 5
            self.world.advance(self.t)
        self.assertIsNone(self.plasticity.problem)

    def test_a_sidecar_copied_before_the_snapshot_resumes(self):
        self.live(3 * 3600)
        side = self.copies / "sidecar.json"
        shutil.copyfile(self.sidecar, side)
        self.live(600)  # she lives on between the two copies, as on the VM
        db = snapshot(self.db, self.copies / "day-3.sqlite3")
        before = {p.name: digest(p) for p in (side, db)}
        record = restore.check(db, side, "research-9101", "active")
        self.assertEqual(record["problems"], [])
        self.assertEqual(record["life"]["life_id"], "research-9101")
        self.assertEqual(record["database"]["integrity"], "ok")
        self.assertGreater(record["sidecar"]["ticks_behind_her"], 0)
        self.assertFalse(record["sidecar"]["mode_changed_by_restore"])
        # The copies are untouched and nothing was left beside them.
        self.assertEqual({p.name: digest(p) for p in (side, db)}, before)
        self.assertEqual(sorted(p.name for p in self.copies.iterdir()), ["day-3.sqlite3", "sidecar.json"])

    def test_a_sidecar_ahead_of_the_snapshot_is_refused(self):
        self.live(3 * 3600)
        db = snapshot(self.db, self.copies / "day-3.sqlite3")
        self.live(600)
        side = self.copies / "sidecar.json"
        shutil.copyfile(self.sidecar, side)
        record = restore.check(db, side, "research-9101", "active")
        self.assertEqual(len(record["problems"]), 1)
        self.assertIn("past her tick", record["problems"][0])

    def test_another_life_a_missing_sidecar_and_another_mode_are_reported(self):
        self.live(3600)
        side = self.copies / "sidecar.json"
        shutil.copyfile(self.sidecar, side)
        db = snapshot(self.db, self.copies / "day-3.sqlite3")
        self.assertTrue(any("is not" in p for p in restore.check(db, side, "research-1", "active")["problems"]))
        self.assertTrue(any("no sidecar" in p for p in restore.check(db, None, None, "active")["problems"]))
        self.assertTrue(any("not 'shadow'" in p for p in restore.check(db, side, None, "shadow")["problems"]))
        other = Path(tempfile.mkdtemp(prefix="eva-restore-other-"))
        try:
            stranger = study.birth(other, 9102, "autumn")
            refused = restore.check(stranger, side, None, "active")["problems"]
            self.assertTrue(any("different life" in p for p in refused))
        finally:
            shutil.rmtree(other, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
