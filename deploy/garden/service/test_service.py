"""Eva's service with and without embodied plasticity, side by side in simulated time.

Research gardens only: every life here is born in a temporary directory. No
network, no VM, no copy of Eva's database.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import eva_plasticity  # noqa: E402
import learning  # noqa: E402
import server as patched  # noqa: E402

TAG = "  # eva-plasticity"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


original = _load("eva_original_server", HERE / "original" / "server.py")
START = datetime(2026, 11, 7, 15, 0, tzinfo=timezone.utc).timestamp()  # 10:00 in Bethesda


def make(module, db, now, plasticity=None):
    world = module.World.__new__(module.World)
    if plasticity is not None:
        world.plasticity = plasticity
    world.__init__(str(db), now)
    world.db.execute("PRAGMA synchronous=OFF")  # harness speed only
    return world


def row(world):
    return world.db.execute("SELECT value FROM world WHERE id=1").fetchone()[0]


def moments(world):
    return world.db.execute("SELECT id, at, words FROM moments ORDER BY id").fetchall()


def born(directory: Path, body=None) -> Path:
    """A research garden: born by the original service, then optionally impaired."""
    db = directory / "born.sqlite3"
    world = make(original, db, START)
    if body:
        world.state["body"].update(body)
        world._save()
    world.close()
    return db


def copy(db: Path, name: str) -> Path:
    target = db.with_name(name + ".sqlite3")
    shutil.copyfile(db, target)
    return target


def run(worlds, start, seconds, weather=None):
    for t in range(int(start) + 5, int(start + seconds) + 1, 5):
        if weather and (t - int(start)) % 3600 == 5:
            for w in worlds:
                w.set_weather({**weather, "fetched_at": t})
        for w in worlds:
            w.advance(t)
    return start + seconds


RAIN = {"temperature": 12.0, "code": 61, "wind": 9.0, "rain": 1.5, "source": "test", "sun": {}}


class SourceTests(unittest.TestCase):
    def test_the_sources_are_the_vms_byte_for_byte(self):
        manifest = json.loads((HERE / "MANIFEST.json").read_text(encoding="utf-8"))
        for name, digest in manifest["files"].items():
            self.assertEqual(hashlib.sha256((HERE / name).read_bytes()).hexdigest(), digest, name)

    def test_removing_the_tagged_lines_gives_the_original_server(self):
        text = (HERE / "server.py").read_bytes().decode("utf-8")
        kept = "".join(line for line in text.splitlines(keepends=True) if not line.rstrip("\n").endswith(TAG))
        self.assertEqual(kept.encode("utf-8"), (HERE / "original" / "server.py").read_bytes())
        self.assertGreater(text.count(TAG), 0)


class SideBySideTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="eva-research-"))

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _three(self, body=None, weather=None, hours=6):
        db = born(self.dir, body)
        sidecar = self.dir / ("eva" + eva_plasticity.SIDECAR_SUFFIX)
        a = make(original, copy(db, "original"), START)
        b = make(patched, copy(db, "off"), START)
        shadow = eva_plasticity.Plasticity("shadow", sidecar, self.dir / "shadow.sqlite3")
        c = make(patched, copy(db, "shadow"), START, shadow)
        run([a, b, c], START, hours * 3600, weather)
        return a, b, c, shadow, sidecar

    def test_off_and_shadow_are_the_original_byte_for_byte(self):
        for body, weather in ((None, None), ({"wing_integrity": 0.3}, None), (None, RAIN)):
            with self.subTest(body=body, weather=bool(weather)):
                a, b, c, shadow, sidecar = self._three(body, weather)
                self.assertEqual(row(a), row(b))
                self.assertEqual(row(a), row(c))
                self.assertEqual(moments(a), moments(c))
                self.assertEqual(shadow.status()["status"], "ok")
                self.assertGreater(shadow.state["samples"], 0)
                self.assertEqual(shadow.state["overrides"], 0)
                kept = json.loads(sidecar.read_text(encoding="utf-8"))
                self.assertEqual(kept["life_id"], a.state["life_id"])
                self.assertEqual(kept["born_at"], a.state["born_at"])
                self.assertEqual(kept["last_tick"], shadow.state["last_tick"])
                self.assertLessEqual(kept["last_tick"], a.state["ticks"])
                for w in (a, b, c):
                    w.close()
                sidecar.unlink()

    def test_active_keeps_her_identity_her_clock_and_her_random_stream(self):
        db = born(self.dir, {"wing_integrity": 0.45})
        a = make(original, copy(db, "original"), START)
        active = eva_plasticity.Plasticity("active", self.dir / ("eva" + eva_plasticity.SIDECAR_SUFFIX), db)
        c = make(patched, copy(db, "active"), START, active)
        run([a, c], START, 6 * 3600, RAIN)
        x, y = json.loads(row(a)), json.loads(row(c))
        for key in ("life_id", "born_at", "seed", "ticks", "updated_at"):
            self.assertEqual(x[key], y[key], key)
        self.assertEqual(active.status()["status"], "ok")
        a.close()
        c.close()

    def test_a_restart_continues_what_she_and_it_learned(self):
        db = born(self.dir, {"wing_integrity": 0.3})
        first, second = self.dir / ("one" + eva_plasticity.SIDECAR_SUFFIX), self.dir / ("two" + eva_plasticity.SIDECAR_SUFFIX)
        straight_db, restarted_db = copy(db, "straight"), copy(db, "restarted")
        straight = eva_plasticity.Plasticity("shadow", first, straight_db)
        s = make(patched, straight_db, START, straight)
        p1 = eva_plasticity.Plasticity("shadow", second, restarted_db)
        r = make(patched, restarted_db, START, p1)
        middle = run([s, r], START, 3 * 3600)
        r.close()
        p2 = eva_plasticity.Plasticity("shadow", second, restarted_db)
        r = make(patched, restarted_db, middle, p2)
        self.assertEqual(p2.status()["status"], "ok")
        self.assertEqual(p2.state["samples"], p1.state["samples"])
        run([s, r], middle, 3 * 3600)
        self.assertEqual(row(s), row(r))
        for key in ("stats", "samples", "discarded", "duplicates", "last_tick", "would_override"):
            self.assertEqual(straight.state[key], p2.state[key], key)
        s.close()
        r.close()
        # A later start in active mode is recorded, forward only.
        p3 = eva_plasticity.Plasticity("active", second, restarted_db)
        r = make(patched, restarted_db, middle + 3 * 3600, p3)
        self.assertEqual([h["to"] for h in p3.state["mode_history"]], ["shadow", "active"])
        self.assertEqual(p3.state["samples"], p2.state["samples"])
        r.close()

    def test_a_fault_leaves_her_as_the_original(self):
        db = born(self.dir)
        blocker = self.dir / "not-a-directory"
        blocker.write_text("x", encoding="utf-8")
        broken = eva_plasticity.Plasticity("active", blocker / ("eva" + eva_plasticity.SIDECAR_SUFFIX), db)
        a = make(original, copy(db, "original"), START)
        c = make(patched, copy(db, "faulty"), START, broken)
        run([a, c], START, 2 * 3600)
        self.assertTrue(broken.status()["status"].startswith("faulted"))
        self.assertIsNone(broken.state)
        self.assertEqual(row(a), row(c))
        a.close()
        c.close()


def life(ticks=100, trials=100, condition="warm:rested:sound:dry"):
    return {
        "life_id": "research",
        "born_at": 1.0,
        "ticks": ticks,
        "updated_at": 500.0,
        "energy": 80.0,
        "body": {"wing_integrity": 1.0, "leg_integrity": 1.0, "wetness": 0.0},
        "learning": {
            "trials": trials,
            "models": {f"{m}/{condition}": {"gain": 0.006, "samples": 10, "successes": 10, "error": 0.0} for m in ("fly", "walk")},
            "last": None,
        },
    }


WARM = {"temperature": 20}


class PlasticityTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="eva-plasticity-"))
        self.sidecar = self.dir / ("eva" + eva_plasticity.SIDECAR_SUFFIX)
        self.db = self.dir / "world.sqlite3"

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def brain(self, mode="active", state=None):
        p = eva_plasticity.Plasticity(mode, self.sidecar, self.db)
        p.bind(state or life())
        return p

    def step(self, p, s, motion, progress, effort=1.0):
        s["ticks"] += 1
        s["updated_at"] += 5
        s["learning"]["last"] = {"at": s["updated_at"], "action": motion, "condition": "warm:rested:sound:dry",
                                 "observed_position": [0.5 + progress * effort * 5, 0.5]}
        p.observe(s, motion, [0.5, 0.5], [0.9, 0.5], [effort, 0.0], 5.0)

    def teach(self, p, s, n=40, fly=0.002, walk=0.004):
        for i in range(n):
            self.step(p, s, "fly", fly * (1 + 0.01 * (i % 3)))
            self.step(p, s, "walk", walk * (1 + 0.01 * (i % 3)))

    def test_learns_each_executed_step_once(self):
        s = life()
        p = self.brain(state=s)
        self.step(p, s, "fly", 0.003)
        p.observe(s, "fly", [0.5, 0.5], [0.9, 0.5], [1.0, 0.0], 5.0)  # the same tick again
        self.assertEqual((p.state["samples"], p.state["duplicates"]), (1, 1))
        self.assertAlmostEqual(p.state["stats"]["fly/warm:rested:sound:dry"]["mean"], 0.003)

    def test_discards_what_it_cannot_attribute(self):
        s = life()
        p = self.brain(state=s)
        self.step(p, s, "fly", 0.003, effort=0.2)  # too little effort to measure
        s["ticks"] += 1
        s["learning"]["last"] = {"at": s["updated_at"] - 1, "action": "walk"}  # not this step's trial
        p.observe(s, "fly", [0.5, 0.5], [0.9, 0.5], [1.0, 0.0], 5.0)
        self.assertEqual((p.state["samples"], p.state["discarded"]), (0, 2))

    def test_active_swaps_only_with_confident_evidence(self):
        s = life()
        p = self.brain(state=s)
        self.teach(p, s, n=10)
        self.assertEqual(p.choose(s, WARM, "fly"), "fly")  # too little evidence
        self.teach(p, s, n=30)
        s["learning"]["trials"] = 101
        self.assertEqual(p.choose(s, WARM, "fly"), "walk")
        self.assertEqual(p.state["overrides"], 1)
        self.assertEqual(p.state["last_override"]["to"], "walk")
        self.assertEqual(p.choose(s, WARM, "walk"), "walk")  # never swaps toward the worse motion

    def test_her_exploration_rule_stays_hers(self):
        s = life()
        p = self.brain(state=s)
        self.teach(p, s)
        s["learning"]["trials"] = 37 * 3
        self.assertEqual(p.choose(s, WARM, "fly"), "fly")
        s["learning"]["trials"] = 101
        s["learning"]["models"]["walk/warm:rested:sound:dry"]["samples"] = 2
        self.assertEqual(p.choose(s, WARM, "fly"), "fly")

    def test_overlapping_evidence_never_swaps(self):
        s = life()
        p = self.brain(state=s)
        for i in range(60):
            self.step(p, s, "fly", 0.003 + 0.002 * (i % 2))
            self.step(p, s, "walk", 0.0035 + 0.002 * (i % 2))
        s["learning"]["trials"] = 101
        self.assertEqual(p.choose(s, WARM, "fly"), "fly")

    def test_shadow_counts_but_never_swaps(self):
        s = life()
        p = self.brain("shadow", s)
        self.teach(p, s)
        s["learning"]["trials"] = 101
        before = json.dumps(s, sort_keys=True)
        self.assertEqual(p.choose(s, WARM, "fly"), "fly")
        self.assertEqual((p.state["would_override"], p.state["overrides"]), (1, 0))
        self.assertEqual(json.dumps(s, sort_keys=True), before)

    def test_memory_is_bounded(self):
        s = life()
        p = self.brain(state=s)
        for _ in range(eva_plasticity.PARAMS["count_cap"] + 10):
            self.step(p, s, "fly", 0.003)
        stat = p.state["stats"]["fly/warm:rested:sound:dry"]
        self.assertLessEqual(stat["n"], eva_plasticity.PARAMS["count_cap"])
        self.assertEqual(len(p.state["recent"]), eva_plasticity.PARAMS["recent"])
        p.save()
        self.assertLess(self.sidecar.stat().st_size, 20_000)

    def test_refuses_another_life_and_a_sidecar_ahead_of_her(self):
        s = life()
        p = self.brain(state=s)
        self.step(p, s, "fly", 0.003)
        p.save()
        saved = self.sidecar.read_bytes()
        for other in ({**life(), "life_id": "someone else"}, {**life(), "born_at": 2.0}, life(ticks=50)):
            q = eva_plasticity.Plasticity("active", self.sidecar, self.db)
            q.bind(other)
            self.assertTrue(q.status()["status"].startswith("refused"), other)
            self.assertEqual(q.choose(other, WARM, "fly"), "fly")
            q.observe(other, "fly", [0.5, 0.5], [0.9, 0.5], [1.0, 0.0], 5.0)
            q.save()
            self.assertEqual(self.sidecar.read_bytes(), saved)

    def test_refuses_corrupt_or_foreign_sidecars(self):
        for text in ("not json", json.dumps({"schema": "eva-contextual-plasticity/v1"}), json.dumps([1])):
            self.sidecar.write_text(text, encoding="utf-8")
            q = eva_plasticity.Plasticity("shadow", self.sidecar, self.db)
            q.bind(life())
            self.assertTrue(q.status()["status"].startswith("refused"))

    def test_the_sidecar_is_never_her_database_or_a_backup(self):
        with self.assertRaises(ValueError):
            eva_plasticity.Plasticity("active", self.db, self.db)
        with self.assertRaises(ValueError):
            eva_plasticity.Plasticity("active", self.dir / "backups" / ("x" + eva_plasticity.SIDECAR_SUFFIX), self.db)
        with self.assertRaises(ValueError):
            eva_plasticity.Plasticity("eager", self.sidecar, self.db)

    def test_atomic_save_and_a_daily_copy(self):
        s = life()
        p = self.brain(state=s)
        self.step(p, s, "walk", 0.003)
        p.save()
        kept = eva_plasticity.check(json.loads(self.sidecar.read_text(encoding="utf-8")))
        self.assertEqual(kept["samples"], 1)
        copies = list(self.dir.glob("eva" + eva_plasticity.SIDECAR_SUFFIX + ".day-*"))
        self.assertEqual(len(copies), 1)
        self.assertEqual([f for f in self.dir.iterdir() if f.name.endswith(".tmp")], [])
        self.assertIsNotNone(p.status()["last_daily_copy_at"])

    def test_environment(self):
        saved = {k: os.environ.pop(k, None) for k in ("EVA_PLASTICITY", "EVA_PLASTICITY_SIDECAR")}
        try:
            self.assertIsNone(eva_plasticity.from_environment(str(self.db)))
            os.environ["EVA_PLASTICITY"] = "shadow"
            with self.assertRaises(SystemExit):  # never a new life in her place
                eva_plasticity.from_environment(str(self.db))
            sqlite3.connect(self.db).close()
            p = eva_plasticity.from_environment(str(self.db))
            self.assertEqual((p.mode, p.path.name), ("shadow", "eva" + eva_plasticity.SIDECAR_SUFFIX))
        finally:
            for k, v in saved.items():
                os.environ.pop(k, None)
                if v is not None:
                    os.environ[k] = v


class ServiceTests(unittest.TestCase):
    """The real `serve()` in its own process, offline."""

    def test_state_reports_the_extension_and_the_same_life(self):
        directory = Path(tempfile.mkdtemp(prefix="eva-service-"))
        try:
            db = directory / "world.sqlite3"
            world = make(original, db, time.time())
            life_id = world.state["life_id"]
            world.close()
            with socket.socket() as s:
                s.bind(("127.0.0.1", 0))
                port = s.getsockname()[1]
            env = {**os.environ, "FLY_DB": str(db), "FLY_PORT": str(port), "EVA_PLASTICITY": "shadow",
                   "HTTPS_PROXY": "http://127.0.0.1:9", "https_proxy": "http://127.0.0.1:9", "PYTHONPATH": str(HERE)}
            proc = subprocess.Popen([sys.executable, str(HERE / "server.py")], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                state = None
                for _ in range(100):
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/state", timeout=2) as r:
                            state = json.load(r)
                        break
                    except OSError:
                        time.sleep(0.1)
                self.assertIsNotNone(state, "the service never answered")
                self.assertEqual(state["life_id"], life_id)
                self.assertEqual(state["adaptive"]["version"], eva_plasticity.VERSION)
                self.assertEqual(state["adaptive"]["mode"], "shadow")
                self.assertEqual(state["adaptive"]["status"], "ok")
                self.assertEqual(state["adaptive"]["life_id"], life_id)
            finally:
                proc.terminate()
                proc.wait(timeout=20)
                if proc.stderr:
                    proc.stderr.close()
        finally:
            shutil.rmtree(directory, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
