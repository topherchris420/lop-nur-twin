#!/usr/bin/env python3
"""Unit tests for the reference bridge's own logic. Standard library only.

    python3 tools/rain-bridge/test_bridge.py            # synthetic R.A.I.N. records
    RAIN_LIBRARY_PATH=../james_library python3 tools/rain-bridge/test_bridge.py

The records here are synthetic, shaped like R.A.I.N.'s session artifact, and
the corpus is a stand-in with R.A.I.N.'s function names; nothing is imported
from james_library and no model runs. With RAIN_LIBRARY_PATH set, the last
case also reads R.A.I.N.'s own meeting script and checks that what the bridge
looks for in it — the declared team, the fixed lines, the console lines — is
still there.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rain_bethesda_bridge as bridge  # noqa: E402

QUESTION = "What evidence would distinguish coordinated crowd behavior from coincidental local responses?"
PAPER = "papers/closure.md"
PAPER_TEXT = ("# Closures\n\nCrowds near a closed entrance wait before they disperse.\n"
              "Onlookers gather where an event is visible.\n")
SCRIPT = textwrap.dedent('''
    class RainLabAgentFactory:
        def create_team(self):
            return [Agent(name="James", role="Lead Scientist"), Agent(name="Jasmine", role="Hardware Architect"),
                    Agent(name="Luca", role="Theorist"), Agent(name="Elena", role="Information Theorist")]

    def generate(agent):
        content = f"[{agent.name} is processing... Let me gather my thoughts on this topic.]"
        return content

    def close(writer):
        writer.record_turn(agent_name="James", content="Meeting adjourned. Great discussion everyone!")
        writer.record_turn(agent_name="SYSTEM", content=message)
''')
CLOSING = "Meeting adjourned. Great discussion everyone!"


def corpus_for(root: Path) -> SimpleNamespace:
    """A stand-in for james_library.utilities.citation_corpus with its call shapes."""
    def verify_quote(documents: dict[str, str], quote: str):
        flat = " ".join(quote.split())
        for source, text in documents.items():
            at = text.find(flat)
            if at >= 0:
                return SimpleNamespace(source=source, span_start=at, span_end=at + len(flat))
        return None

    return SimpleNamespace(
        resolve_corpus_root=lambda work: work,
        discover_corpus_files=lambda r: sorted((r / "papers").glob("*.md")),
        hash_corpus_files=lambda files, r: [{"path": f.relative_to(r).as_posix(),
                                             "sha256": hashlib.sha256(f.read_bytes()).hexdigest()} for f in files],
        verify_quote=verify_quote)


def turn(agent: str, content: str, quotes: tuple[str, ...] = ()) -> dict:
    return {"agent": agent, "content": content, "metadata": {},
            "grounded_response": {"evidence": [{"quote": q, "source": PAPER} for q in quotes]}}


class ModelMeetingRecord(unittest.TestCase):
    def setUp(self) -> None:
        self.work = Path(tempfile.mkdtemp(prefix="rain-bridge-test-"))
        (self.work / "papers").mkdir()
        (self.work / PAPER).write_text(PAPER_TEXT, encoding="utf-8")
        (self.work / bridge.MEETING_SCRIPT).write_text(SCRIPT, encoding="utf-8")
        self.corpus = corpus_for(self.work)

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.work, ignore_errors=True)

    def artifact(self, turns: list[dict], **extra) -> Path:
        path = self.work / "session_test.json"
        path.write_text(json.dumps({"schema_version": bridge.ARTIFACT_SCHEMA, "status": "completed",
                                    "topic": QUESTION, "model": "qwen2.5:7b", "session_id": "3298be35",
                                    "completed_at": "2026-10-03T04:00:00Z", "turns": turns, **extra}),
                        encoding="utf-8")
        return path

    def record(self, turns: list[dict], *, model_stopped: bool = False, **extra) -> dict:
        return bridge.model_meeting_record(self.work, self.artifact(turns, **extra), QUESTION, "a" * 32,
                                           {"repository": "topherchris420/james_library",
                                            "commit": "9" * 40, "dirty": False},
                                           self.corpus, model_stopped=model_stopped)

    def meeting(self) -> list[dict]:
        return [turn("James", "Crowds wait first, as the paper says.",
                     ("Crowds near a closed entrance wait before they disperse.",)),
                turn("Jasmine", "[Jasmine is processing... Let me gather my thoughts on this topic.]"),
                turn("SYSTEM", "SYSTEM: Research process suggestion: narrow the question."),
                turn("Luca", "An invented quote follows.", ("Crowds always panic at closures.",)),
                turn("Elena", "Onlookers gather where they can see.",
                     ("Onlookers gather   where an event\nis visible.",)),
                turn("James", CLOSING)]

    def test_every_turn_says_who_wrote_it(self) -> None:
        r = self.record(self.meeting())
        self.assertEqual([t["speaker"] for t in r["turns"]], ["James", "Jasmine", "Luca", "Elena", "James"])
        self.assertEqual([t["generation"] for t in r["turns"]],
                         ["model", "scripted", "model", "model", "scripted"])
        self.assertEqual([t["move"] for t in r["turns"]],
                         ["speaks", "stands in for an unusable answer", "speaks", "speaks",
                          "closes the meeting"])
        self.assertEqual([t["role"] for t in r["turns"]][:2], ["Lead Scientist", "Hardware Architect"])
        self.assertEqual((r["generation"], r["model"], r["verdict"], r["grounding"]),
                         ("model", "qwen2.5:7b", None, None))

    def test_quotes_are_reverified_and_located(self) -> None:
        r = self.record(self.meeting())
        james, luca, elena = r["turns"][0], r["turns"][2], r["turns"][3]
        self.assertEqual(len(james["quotes"]), 1)
        q = james["quotes"][0]
        self.assertEqual((q["source"], q["line"], q["verified"]), (PAPER, 3, True))
        self.assertEqual(PAPER_TEXT[q["span_start"]:q["span_end"]], q["text"])
        self.assertEqual((luca["quotes"], luca["unverified"]), ([], 1))  # an invented quote is not carried
        self.assertEqual(len(elena["quotes"]), 1)  # whitespace collapses, as R.A.I.N.'s matcher does
        self.assertEqual(r["audit"]["checked"], r["audit"]["verified"])
        self.assertEqual(r["audit"]["corpus_files"], 1)

    def test_names_rains_record_by_hash(self) -> None:
        path = self.artifact(self.meeting())
        r = bridge.model_meeting_record(self.work, path, QUESTION, "a" * 32, {"commit": None}, self.corpus)
        self.assertEqual(r["source_artifact"], {"schema": bridge.ARTIFACT_SCHEMA, "session_id": "3298be35",
                                                "status": "completed",
                                                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        self.assertEqual(r["meeting_id"], "rain-model-3298be35")

    def test_a_meeting_the_model_stopped_says_where(self) -> None:
        r = self.record(self.meeting(), model_stopped=True)
        self.assertIn("The model stopped answering after this turn", r["turns"][3]["coda"])
        self.assertEqual(r["turns"][4]["coda"], "")  # not on R.A.I.N.'s closing line
        self.assertNotIn("stopped", " ".join(t["coda"] for t in r["turns"][:3]))
        self.assertNotIn("stopped", " ".join(t["coda"] for t in self.record(self.meeting())["turns"]))

    def test_a_meeting_without_a_word_from_the_model_fails(self) -> None:
        placeholders = [turn(n, f"[{n} is processing... Let me gather my thoughts on this topic.]")
                        for n in ("James", "Jasmine")] + [turn("James", CLOSING)]
        with self.assertRaisesRegex(bridge.MeetingFailed, "no turn from the model$"):
            self.record(placeholders)
        with self.assertRaisesRegex(bridge.MeetingFailed, "before the model stopped answering"):
            self.record(placeholders, model_stopped=True)

    def test_refuses_a_record_it_cannot_vouch_for(self) -> None:
        for extra, reason in [({"schema_version": "rain-session-artifact/v9"}, "not a session artifact"),
                              ({"status": "in_progress"}, "did not finish"),
                              ({"topic": "Another question?"}, "different question"),
                              ({"model": "http://evil.example/m"}, "no usable model"),
                              ({"session_id": "../x"}, "no session id")]:
            with self.subTest(reason=reason), self.assertRaisesRegex(bridge.MeetingFailed, reason):
                self.record(self.meeting(), **extra)

    def test_cleans_and_bounds_what_it_carries(self) -> None:
        long = "x" * (bridge.TURN_TEXT + 50)
        r = self.record([turn("James", "a\u202eb"), turn("Luca", long), turn("James", CLOSING)])
        self.assertEqual(r["turns"][0]["lead"], "ab")
        self.assertIn("removed 1 invisible", r["turns"][0]["coda"])
        self.assertLessEqual(len(r["turns"][1]["lead"]), bridge.TURN_TEXT)
        self.assertIn("shortened", r["turns"][1]["coda"])


class FixedLines(unittest.TestCase):
    def test_reads_literals_and_fstrings_never_runs_them(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            script = Path(d) / "s.py"
            script.write_text(SCRIPT + "\nraise SystemExit('never executed')\n", encoding="utf-8")
            fixed = bridge.fixed_lines(script)
            self.assertTrue(any(p.fullmatch(CLOSING) for p in fixed["closing"]))
            self.assertTrue(any(p.fullmatch("[Luca is processing... Let me gather my thoughts on this topic.]")
                                for p in fixed["placeholder"]))
            self.assertFalse(any(p.fullmatch("Luca argues the opposite.") for ps in fixed.values() for p in ps))
            self.assertEqual(bridge.declared_team(script)["Elena"], "Information Theorist")


class MeetingEnvironment(unittest.TestCase):
    def test_no_credential_reaches_the_meeting(self) -> None:
        meetings = bridge.ModelMeetings(SimpleNamespace(), python="python", base_url="http://127.0.0.1:1/v1",
                                        model="qwen2.5:7b", turns=4, timeout_s=300, recursion=False,
                                        token_env="RAIN_BRIDGE_TOKEN")
        hostile = {"TYPESAFE_API_KEY": "k", "RAIN_BRIDGE_TOKEN": "t", "rain_bridge_token": "t2",
                   "RAIN_DECISION_MODE": "jev", "RAIN_DECISION_REMOTE_ALLOWED": "true", "PATH": "/bin"}
        with mock.patch.dict(os.environ, hostile, clear=True):
            env = meetings.environment()
        self.assertFalse({"TYPESAFE_API_KEY", "RAIN_BRIDGE_TOKEN", "rain_bridge_token"} & set(env))
        self.assertEqual((env["RAIN_DECISION_MODE"], env["RAIN_DECISION_REMOTE_ALLOWED"]), ("off", "false"))
        self.assertEqual((env["RAIN_LLM_MODEL"], env["PATH"]), ("qwen2.5:7b", "/bin"))


@unittest.skipUnless(os.environ.get("RAIN_LIBRARY_PATH"), "set RAIN_LIBRARY_PATH to read R.A.I.N.'s script")
class RainsOwnScript(unittest.TestCase):
    def test_what_the_bridge_reads_is_still_there(self) -> None:
        script = Path(os.environ["RAIN_LIBRARY_PATH"]) / bridge.MEETING_SCRIPT
        source = script.read_text(encoding="utf-8")
        self.assertEqual(set(bridge.declared_team(script)), set(bridge.PERSPECTIVES))
        fixed = bridge.fixed_lines(script)
        self.assertTrue(any(p.fullmatch(CLOSING) for p in fixed["closing"]))
        self.assertTrue(any(p.fullmatch("[Elena is processing... Let me gather my thoughts on this topic.]")
                            for p in fixed["placeholder"]))
        # The console lines the bridge reads: a turn starting, and the model giving up.
        self.assertRegex(source, re.escape("▶ {current_agent.name}'s turn"))
        self.assertRegex(source, bridge.MODEL_STOPPED.pattern)


if __name__ == "__main__":
    unittest.main(verbosity=2)
