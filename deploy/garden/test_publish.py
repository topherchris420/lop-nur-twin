"""publish.py end to end, against a scratch web root: publish, refuse, put back.

    python3 -m unittest deploy/garden/test_publish.py      (python on Windows)

A small HTTP server stands in for nginx (the web root, as files) and for the
garden (its state at /state); systemd is a dictionary. Nothing here reaches
the real server.
"""
from __future__ import annotations

import contextlib
import gzip
import hashlib
import importlib.util
import io
import json
import os
import tempfile
import threading
import time
import unittest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

_spec = importlib.util.spec_from_file_location("publish", Path(__file__).with_name("publish.py"))
publish = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(publish)

LIFE = {"life_id": "5cf42cd6-fd0a-474d-882c-4cb70e0357e8", "born_at": 1792908400.321717}
OLD = "ui-20261025-9abcdf40d541"
OLD_PAGE = (
    f'<!doctype html><link rel="stylesheet" href="/{OLD}/style.css">'
    f'<script src="/{OLD}/app.js"></script>'
).encode()
RELEASE = "garden-20261026-0123456789ab"
SCRIPT = b"export const garden = 1;\n" * 200
PAGE = (
    f'<!doctype html><script type="module" src="/{RELEASE}/assets/index-abc.js"></script>'
).encode()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Garden:
    """The garden's state and its systemd units, as the tests set them."""

    def __init__(self):
        self.moments = 640
        self.lives = [LIFE]
        self.pids = ["4242"]
        self.backup_result = "success"
        self.state_calls = 0
        self.pid_calls = 0

    def state(self) -> dict:
        life = self.lives[min(self.state_calls, len(self.lives) - 1)]
        self.state_calls += 1
        self.moments += 1
        return {**life, "moments_count": self.moments, "ticks": 24000 + self.state_calls}

    def show(self, unit: str, prop: str) -> str:
        if (unit, prop) == ("bethesda-fly", "MainPID"):
            pid = self.pids[min(self.pid_calls, len(self.pids) - 1)]
            self.pid_calls += 1
            return pid
        if (unit, prop) == ("bethesda-fly-backup.service", "Result"):
            return self.backup_result
        raise AssertionError(f"unexpected systemctl show {unit} {prop}")


class Site(SimpleHTTPRequestHandler):
    garden: Garden

    def do_GET(self):
        if self.path == "/state":
            body = json.dumps(self.garden.state()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'")
        super().end_headers()

    def log_message(self, *args):
        pass


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.root = base / "www" / "bethesda-fly"
        (self.root / OLD).mkdir(parents=True)
        (self.root / "index.html").write_bytes(OLD_PAGE)
        (self.root / OLD / "style.css").write_bytes(b"body{}")
        (self.root / OLD / "app.js").write_bytes(b"void 0;")
        self.saved = base / "backups-ui"
        self.life_backups = base / "lib" / "backups"
        self.life_backups.mkdir(parents=True)
        (self.life_backups / "day-0.sqlite3").write_bytes(b"SQLite format 3\0")
        self.stage = base / "stage" / RELEASE
        self.stage_files({"index.html": PAGE, "assets/index-abc.js": SCRIPT})

        self.garden = Garden()
        handler = type("Handler", (Site,), {"garden": self.garden})
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(handler, directory=str(self.root)))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def stage_files(self, files: dict, gz: bool = True):
        for rel, data in files.items():
            (self.stage / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.stage / rel).write_bytes(data)
        if gz:
            (self.stage / "assets/index-abc.js.gz").write_bytes(gzip.compress(SCRIPT))
        manifest = {"release": RELEASE, "sha256": {rel: sha256(d) for rel, d in files.items()}}
        (self.stage / "manifest.json").write_text(json.dumps(manifest))

    def run_publish(self, *argv: str) -> tuple[int, dict]:
        common = [
            "--root", str(self.root),
            "--saved", str(self.saved),
            "--life-backups", str(self.life_backups),
            "--origin", self.origin,
            "--state", f"{self.origin}/state",
        ]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = publish.main([*common, *argv], show=self.garden.show)  # argv overrides
        return code, json.loads(out.getvalue())

    def publish_stage(self, expect: bytes = OLD_PAGE) -> tuple[int, dict]:
        return self.run_publish(str(self.stage), "--expect-index", sha256(expect))

    def assert_untouched(self):
        self.assertEqual((self.root / "index.html").read_bytes(), OLD_PAGE)

    def test_publishes_beside_the_old_page_and_keeps_the_life(self):
        code, out = self.publish_stage()
        self.assertEqual(code, 0, out)
        self.assertEqual((self.root / "index.html").read_bytes(), PAGE)
        self.assertEqual((self.root / RELEASE / "assets/index-abc.js").read_bytes(), SCRIPT)
        self.assertEqual(
            gzip.decompress((self.root / RELEASE / "assets/index-abc.js.gz").read_bytes()), SCRIPT
        )
        self.assertTrue((self.root / OLD / "app.js").exists())
        self.assertEqual((self.saved / RELEASE / "index.html").read_bytes(), OLD_PAGE)
        self.assertEqual(out["life_id"], LIFE["life_id"])
        self.assertEqual(out["replaced_index_sha256"], sha256(OLD_PAGE))
        self.assertFalse(out["service_restarted"])
        self.assertEqual(out["files"], 4)  # index, script, its twin, manifest
        self.assertFalse(list(self.root.parent.glob(".*.partial")))

    def test_refuses_a_live_page_that_changed_since_inspection(self):
        code, out = self.publish_stage(expect=b"another page")
        self.assertEqual(code, 2)
        self.assertFalse(out["live_index_changed"])
        self.assert_untouched()
        self.assertFalse((self.root / RELEASE).exists())

    def test_refuses_without_a_fresh_backup_of_the_life(self):
        old = time.time() - 4000
        os.utime(self.life_backups / "day-0.sqlite3", (old, old))
        code, out = self.publish_stage()
        self.assertEqual(code, 2)
        self.assertIn("min old", out["error"])
        self.assert_untouched()

    def test_refuses_when_the_backup_unit_last_failed(self):
        self.garden.backup_result = "exit-code"
        code, out = self.publish_stage()
        self.assertEqual(code, 2)
        self.assertIn("exit-code", out["error"])
        self.assert_untouched()

    def test_refuses_files_the_manifest_does_not_vouch_for(self):
        (self.stage / "assets/index-abc.js").write_bytes(b"tampered")
        self.assertEqual(self.publish_stage()[0], 2)
        self.stage_files({"index.html": PAGE, "assets/index-abc.js": SCRIPT})
        (self.stage / "assets/extra.js").write_bytes(b"1")
        code, out = self.publish_stage()
        self.assertEqual(code, 2)
        self.assertIn("not in the manifest", out["error"])
        (self.stage / "assets/extra.js").unlink()
        (self.stage / "assets/index-abc.js.gz").write_bytes(gzip.compress(b"something else"))
        code, out = self.publish_stage()
        self.assertEqual(code, 2)
        self.assertIn("compressed", out["error"])
        self.assert_untouched()

    def test_refuses_when_the_garden_does_not_answer(self):
        code, out = self.run_publish(
            str(self.stage), "--expect-index", sha256(OLD_PAGE), "--state", "http://127.0.0.1:9/state"
        )
        self.assertEqual(code, 2)
        self.assertFalse(out["live_index_changed"])
        self.assert_untouched()

    def test_puts_the_old_page_back_if_the_life_changes(self):
        self.garden.lives = [LIFE, {**LIFE, "life_id": "another"}]
        code, out = self.publish_stage()
        self.assertEqual(code, 1)
        self.assertTrue(out["restored_previous_index"])
        self.assertIn("the life changed", out["error"])
        self.assert_untouched()

    def test_puts_the_old_page_back_if_the_process_changes(self):
        self.garden.pids = ["4242", "5151"]  # before the swap, then after it
        code, out = self.publish_stage()
        self.assertEqual(code, 1)
        self.assertIn("changed process", out["error"])
        self.assert_untouched()

    def test_rolls_back_and_publishes_again(self):
        self.assertEqual(self.publish_stage()[0], 0)
        code, out = self.run_publish("--rollback", RELEASE)
        self.assertEqual(code, 0, out)
        self.assert_untouched()
        code, out = self.publish_stage()
        self.assertEqual(code, 0, out)
        self.assertFalse(out["installed"])  # already there, byte for byte
        self.assertEqual((self.root / "index.html").read_bytes(), PAGE)

    def test_will_not_roll_back_to_a_page_whose_files_are_gone(self):
        self.assertEqual(self.publish_stage()[0], 0)
        (self.root / OLD / "app.js").unlink()
        code, out = self.run_publish("--rollback", RELEASE)
        self.assertEqual(code, 2)
        self.assertEqual((self.root / "index.html").read_bytes(), PAGE)


if __name__ == "__main__":
    unittest.main()
