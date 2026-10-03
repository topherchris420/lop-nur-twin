#!/usr/bin/env python3
"""R.A.I.N.-side adapter for the ``rain-bethesda/v2`` protocol.

Runs inside a ``topherchris420/james_library`` checkout's Python environment
and serves the lop-nur-twin Bethesda lab's server routes over loopback HTTP.
It *imports* james_library and calls its own code paths; it reimplements none
of them:

=====================  =======================================================
``GET  .../identity``  james_library's commit (``git rev-parse HEAD``), dirty
                       state, corpus fingerprint and what this bridge serves.
``POST .../meeting``   ``james_library.launcher.offline_meeting.
                       build_offline_meeting`` on the question: the real
                       four-perspective engine. Its reasoning text is
                       scripted and says so (``generation: "scripted"``);
                       every quote is a verbatim corpus span re-checked with
                       ``citation_corpus.verify_quote``.
                       With ``--meeting-engine model``: james_library's own
                       model meeting (``rain_lab_meeting_chat_version.py``,
                       unchanged) against the local model R.A.I.N. is
                       configured for, as a job (``meeting-pending``).
``POST .../meeting-status``  that job: pending, the meeting (R.A.I.N.'s
                       session artifact, every quote re-verified), or why not.
``POST .../meeting-cancel``  stop it.
``POST .../proposal``  ``judgment.config.create_decision_router().decide`` on
                       the host's own explicit options (``rain-bounded-request``
                       semantics). With ``RAIN_DECISION_MODE=off`` (the
                       default) the router proposes nothing and says DISABLED.
                       A remote engine (Jev) is consulted only when
                       ``RAIN_DECISION_REMOTE_ALLOWED=true``; every attempt
                       is returned, including ones R.A.I.N. did not act on.
``POST .../preregister`` ``experiments.registry.Registry.create`` on the
                       lab's draft: R.A.I.N. assigns ``V3D-EXP-NNNN``.
``POST .../submission`` ``experiments.runner.record_submission``: R.A.I.N.
                       evaluates the pre-registered criteria itself and
                       returns its own run record.
=====================  =======================================================

Boundaries kept here:

* Loopback only unless ``--allow-remote``; optional bearer token from an
  environment variable (never a flag, never logged), compared in constant time.
* Every request body is size-capped, must be JSON, and has a closed set of
  fields. Nothing in a request names a path, URL, module, command or code.
* No shell. Subprocesses take fixed argument lists: ``git``, and for model
  meetings james_library's own meeting script, run from a ``git archive`` copy
  of the checkout's commit (so the checkout is never written), with no web
  search, no speech, decision routing off and no TypeSafe key in its
  environment. The question is one argument; nothing a model says is run.
* The registry defaults to a fresh scratch directory: the committed
  ``experiments/`` registry is written only when ``--registry`` names it.
* Standard library only, so it runs wherever james_library's offline demo does.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

SCHEMA = "rain-bethesda/v2"
BRIDGE = {"name": "rain-bethesda-bridge", "version": "2"}
PREFIX = "/rain-bethesda/v2"
REQUEST_LIMITS = {"meeting": 4 * 1024, "meeting-status": 1024, "meeting-cancel": 1024,
                  "proposal": 16 * 1024, "preregister": 64 * 1024, "submission": 256 * 1024}
HEX32 = re.compile(r"^[0-9a-f]{32}$")
OPTION_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
EXPERIMENT_ID = re.compile(r"^V3D-EXP-[0-9]{4,}$")
UNSAFE_TEXT = re.compile(  # escapes only: the source never contains what it bans
    r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]")
ENGINE = "james_library.launcher.offline_meeting.build_offline_meeting"
#: james_library's own model meeting, run unchanged from a copy of the checkout.
MEETING_SCRIPT = "rain_lab_meeting_chat_version.py"
MODEL_ENGINE = "rain_lab_meeting_chat_version.RainLabOrchestrator.run_meeting"
ARTIFACT_SCHEMA = "rain-session-artifact/v1"
PERSPECTIVES = ("James", "Jasmine", "Luca", "Elena")
#: The lab's limits for one turn (contracts.ts LIMITS).
TURNS, TURN_TEXT, QUOTE_TEXT, QUOTES_PER_TURN = 32, 4000, 800, 12
#: R.A.I.N.'s console line as a turn begins: progress for the lab, never evidence.
TURN_STARTED = re.compile(r"\u25b6 (James|Jasmine|Luca|Elena)'s turn")
#: R.A.I.N.'s console line when the model stops answering and it ends the meeting.
MODEL_STOPPED = re.compile(r"Failed to generate response after retries")
MODEL_ID = re.compile(r"^(?!.*://)[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,95}$")  # a name, never a URL
KEEP_FINISHED_S = 15 * 60
#: Fields `experiment create --from` accepts; the registry assigns the rest.
DRAFT_FIELDS = {"title", "question", "hypothesis", "rationale", "subsystem", "created_by",
                "evidence_class", "runner", "seed", "parameters", "procedure", "variables",
                "metrics", "criteria", "dependencies", "data_policy", "limitations"}


class Refused(Exception):
    """A request the bridge will not serve. The message is safe to return."""

    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status, self.code = status, code


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def text(value: Any, limit: int, *, minimum: int = 1) -> str:
    if not isinstance(value, str) or not minimum <= len(value) <= limit or UNSAFE_TEXT.search(value):
        raise Refused(400, "invalid text field")
    return value


class Library:
    """One james_library checkout, imported in-process."""

    def __init__(self, root: Path):
        self.root = root.resolve()
        if not (self.root / "james_library" / "launcher" / "offline_meeting.py").is_file():
            raise SystemExit(f"{self.root} is not a james_library checkout")
        if str(self.root) not in sys.path:
            sys.path.insert(0, str(self.root))
        from james_library.utilities import citation_corpus  # noqa: PLC0415 - needs sys.path

        self.corpus = citation_corpus
        self.corpus_root = citation_corpus.resolve_corpus_root(self.root)

    def revision(self) -> dict[str, Any]:
        def git(*args: str) -> str:
            return subprocess.run(["git", *args], cwd=self.root, capture_output=True, text=True,
                                  timeout=10, check=True).stdout.strip()

        try:
            commit = git("rev-parse", "HEAD")
            dirty = bool(git("status", "--porcelain", "--untracked-files=no"))
        except (OSError, subprocess.SubprocessError):
            return {"repository": "topherchris420/james_library", "commit": None, "dirty": None}
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            return {"repository": "topherchris420/james_library", "commit": None, "dirty": None}
        return {"repository": "topherchris420/james_library", "commit": commit, "dirty": dirty}

    def corpus_identity(self) -> dict[str, Any]:
        files = self.corpus.discover_corpus_files(self.corpus_root)
        rows = self.corpus.hash_corpus_files(files, self.corpus_root) if files else []
        digest = hashlib.sha256()
        for row in rows:  # the offline engine's own fingerprint construction
            digest.update(f"{row['path']}\0{row['sha256']}\n".encode())
        return {"files": len(rows), "sha256": digest.hexdigest()}

    def documents(self) -> dict[str, str]:
        out = {}
        for path in self.corpus.discover_corpus_files(self.corpus_root):
            source = path.relative_to(self.corpus_root).as_posix()
            out[source] = path.read_text(encoding="utf-8", errors="ignore")
        return out


def meeting_record(library: Library, question: str, request_id: str) -> dict[str, Any]:
    """Run R.A.I.N.'s offline engine and express its meeting in rain-bethesda/v2."""
    from james_library.launcher.offline_meeting import build_offline_meeting  # noqa: PLC0415

    meeting = build_offline_meeting(question, library.corpus_root)
    documents = library.documents()

    def quote(passage: Any) -> dict[str, Any]:
        match = library.corpus.verify_quote(documents, passage.text)
        verified = match is not None and match.source == passage.source
        return {"source": passage.source, "line": passage.line,
                "span_start": match.span_start if verified else passage.span_start,
                "span_end": match.span_end if verified else passage.span_end,
                "text": passage.text, "verified": verified}

    turns = [{"index": i, "speaker": t.speaker, "role": t.role, "move": t.move, "lead": t.lead,
              "quotes": [quote(q) for q in t.quotes], "coda": t.coda, "unverified": 0,
              "generation": "scripted"}
             for i, t in enumerate(meeting.turns, 1)]
    content = {
        "question": meeting.question, "grounding": meeting.grounding,
        "matched_terms": list(meeting.matched_terms), "missing_terms": list(meeting.missing_terms),
        "turns": turns,
        "verdict": {"agreed": meeting.verdict.agreed, "contested": meeting.verdict.contested,
                    "next_move": meeting.verdict.next_move,
                    "read_next": list(meeting.verdict.read_next)},
        "audit": {"checked": meeting.audit.checked, "verified": meeting.audit.verified,
                  "corpus_files": meeting.audit.corpus_files,
                  "corpus_sha256": meeting.audit.corpus_sha256},
        "suggestions": list(meeting.suggestions),
    }
    # The engine is deterministic: the same question over the same corpus is the
    # same meeting, so its id is derived from its content.
    meeting_id = "rain-offline-" + hashlib.sha256(
        json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
    return {"schema": SCHEMA, "kind": "meeting", "request_id": request_id,
            "meeting_id": meeting_id, "generation": "scripted", "engine": ENGINE, "model": None,
            **content, "rain": library.revision(), "produced_at": now_iso(),
            "source_artifact": None}


class MeetingFailed(Exception):
    """A model meeting that ended without a usable record. The message is shown to the lab."""


def declared_team(script: Path) -> dict[str, str]:
    """The roles R.A.I.N.'s model meeting declares in ``RainLabAgentFactory.create_team``.

    Read from its source with ``ast`` and never executed: the lab shows each
    turn's role as R.A.I.N. declared it.
    """
    roles: dict[str, str] = {}
    for node in ast.walk(ast.parse(script.read_text(encoding="utf-8"))):
        if isinstance(node, ast.ClassDef) and node.name == "RainLabAgentFactory":
            for call in ast.walk(node):
                if isinstance(call, ast.Call) and getattr(call.func, "id", None) == "Agent":
                    kw = {k.arg: k.value for k in call.keywords}
                    name, role = kw.get("name"), kw.get("role")
                    if isinstance(name, ast.Constant) and isinstance(role, ast.Constant) \
                            and isinstance(name.value, str) and isinstance(role.value, str):
                        roles[name.value] = role.value
    return roles


def _template(node: ast.expr) -> re.Pattern[str] | None:
    """A string literal, or an f-string with its substitutions as wildcards."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return re.compile(re.escape(node.value))
    if isinstance(node, ast.JoinedStr):
        parts = [re.escape(v.value) if isinstance(v, ast.Constant) and isinstance(v.value, str)
                 else ".{1,80}?" for v in node.values]
        return re.compile("".join(parts), re.S)
    return None


def fixed_lines(script: Path) -> dict[str, list[re.Pattern[str]]]:
    """Text R.A.I.N.'s code writes as a turn itself, read from its source.

    ``closing``: string literals passed as ``record_turn(content=...)``, such as
    its closing line. ``placeholder``: literals assigned to ``content``, such as
    the placeholder R.A.I.N. puts in a turn when the model's answers were
    unusable. Either is R.A.I.N.'s, not the model's, and the record says so.
    """
    found: dict[str, list[re.Pattern[str]]] = {"closing": [], "placeholder": []}
    for node in ast.walk(ast.parse(script.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "record_turn":
            for k in node.keywords:
                if k.arg == "content" and (t := _template(k.value)) is not None:
                    found["closing"].append(t)
        elif isinstance(node, ast.Assign) and any(
                isinstance(n, ast.Name) and n.id == "content" for n in node.targets):
            if (t := _template(node.value)) is not None and t.pattern:
                found["placeholder"].append(t)
    return found


def archive(root: Path, commit: str, dest: Path) -> None:
    """Extract the checkout's commit into ``dest`` with ``git archive``.

    The checkout itself is only read: R.A.I.N.'s meeting writes its log and its
    session artifact into the copy, which is removed afterwards. Only regular
    files and directories are extracted, and nothing outside ``dest``.
    """
    proc = subprocess.Popen(["git", "archive", "--format=tar", commit], cwd=root,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    base = dest.resolve()
    assert proc.stdout is not None
    with tarfile.open(fileobj=proc.stdout, mode="r|") as tar:
        for member in tar:
            target = (base / member.name).resolve()
            if target != base and base not in target.parents:
                raise MeetingFailed("the checkout's archive held a path outside its copy")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                source = tar.extractfile(member)
                assert source is not None
                with source, open(target, "wb") as out:
                    shutil.copyfileobj(source, out)
    if proc.wait(timeout=120) != 0:
        raise MeetingFailed("git archive could not copy the checkout's commit")


def clean_text(value: str) -> tuple[str, int]:
    """Remove the invisible characters the lab refuses, and say how many there were."""
    cleaned = UNSAFE_TEXT.sub("", value.replace("\r\n", "\n"))
    return cleaned, len(value.replace("\r\n", "\n")) - len(cleaned)


def model_meeting_record(work: Path, artifact_path: Path, question: str, request_id: str,
                         revision: dict[str, Any], corpus: Any, *,
                         model_stopped: bool = False) -> dict[str, Any]:
    """Express R.A.I.N.'s session artifact for one model meeting in rain-bethesda/v2.

    The turns are R.A.I.N.'s words as its artifact recorded them. The quotes
    are the ones R.A.I.N.'s citation analyzer verified, each checked again here
    with ``verify_quote`` against the corpus of the same commit. Nothing the
    offline engine computes and this meeting does not — grounding, terms, a
    verdict — is filled in. ``model_stopped`` is R.A.I.N.'s console saying the
    model stopped answering: R.A.I.N. then closes the meeting early and still
    calls it completed, so the record says where it stopped.
    """
    raw = artifact_path.read_bytes()
    artifact = json.loads(raw)
    if artifact.get("schema_version") != ARTIFACT_SCHEMA:
        raise MeetingFailed("R.A.I.N.'s record of the meeting is not a session artifact")
    if artifact.get("status") not in ("completed", "interrupted"):
        raise MeetingFailed("R.A.I.N. did not finish the meeting")
    if artifact.get("topic") != question:
        raise MeetingFailed("R.A.I.N.'s record of the meeting names a different question")
    model = artifact.get("model")
    if not isinstance(model, str) or not MODEL_ID.match(model):
        raise MeetingFailed("R.A.I.N.'s record names no usable model")
    session = artifact.get("session_id")
    if not isinstance(session, str) or not re.fullmatch(r"[A-Za-z0-9_-]{4,64}", session):
        raise MeetingFailed("R.A.I.N.'s record has no session id")
    script = work / MEETING_SCRIPT
    roles, fixed = declared_team(script), fixed_lines(script)
    root = corpus.resolve_corpus_root(work)
    files = corpus.discover_corpus_files(root)
    documents = {f.relative_to(root).as_posix(): f.read_text(encoding="utf-8", errors="ignore")
                 for f in files}
    rows = corpus.hash_corpus_files(files, root) if files else []
    fingerprint = hashlib.sha256()
    for row in rows:  # the offline engine's own fingerprint construction
        fingerprint.update(f"{row['path']}\0{row['sha256']}\n".encode())
    turns: list[dict[str, Any]] = []
    for entry in artifact.get("turns") or []:
        agent, content = entry.get("agent"), entry.get("content")
        # Process hints ("SYSTEM") and a founder's words are not a perspective's turn.
        if agent not in PERSPECTIVES or not isinstance(content, str) or not content.strip():
            continue
        meta = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
        unverified = meta.get("unverified_count") if isinstance(meta.get("unverified_count"), int) else 0
        quotes: list[dict[str, Any]] = []
        grounded = entry.get("grounded_response") if isinstance(entry.get("grounded_response"), dict) else {}
        for ev in grounded.get("evidence") or []:
            text_ = ev.get("quote") if isinstance(ev, dict) else None
            if not isinstance(text_, str) or not text_.strip():
                continue
            if len(text_) > QUOTE_TEXT or len(quotes) >= QUOTES_PER_TURN or UNSAFE_TEXT.search(text_):
                unverified += 1  # cannot be carried as checked
                continue
            match = corpus.verify_quote(documents, text_)
            if match is None:
                unverified += 1
                continue
            quotes.append({"source": match.source,
                           "line": documents[match.source].count("\n", 0, match.span_start) + 1,
                           "span_start": match.span_start, "span_end": match.span_end,
                           "text": text_, "verified": True})
        closing = any(p.fullmatch(content.strip()) for p in fixed["closing"])
        placeholder = not closing and any(p.fullmatch(content.strip()) for p in fixed["placeholder"])
        lead, removed = clean_text(content)
        coda = []
        if removed:
            coda.append(f"The bridge removed {removed} invisible control character(s) from this turn.")
        if len(lead) > TURN_TEXT:
            lead = lead[:TURN_TEXT - 2].rstrip() + " …"
            coda.append("The bridge shortened this turn to the lab's 4,000-character limit.")
        turns.append({"index": len(turns) + 1, "speaker": agent,
                      "role": roles.get(agent) or "role not stated",
                      "move": "closes the meeting" if closing
                      else "stands in for an unusable answer" if placeholder else "speaks",
                      "lead": lead, "quotes": quotes, "coda": " ".join(coda),
                      "unverified": min(unverified, 100),
                      "generation": "scripted" if closing or placeholder else "model"})
    if not any(t["generation"] == "model" for t in turns):
        raise MeetingFailed("R.A.I.N.'s meeting recorded no turn from the model"
                            + (" before the model stopped answering" if model_stopped else ""))
    if model_stopped:
        last = next(t for t in reversed(turns) if t["move"] != "closes the meeting")
        last["coda"] = " ".join(filter(None, [last["coda"], (
            "The model stopped answering after this turn, and R.A.I.N. ended the meeting early "
            "(its console: \"Failed to generate response after retries\"); it still records the "
            "meeting as completed.")]))
    if len(turns) > TURNS:
        raise MeetingFailed(f"R.A.I.N.'s meeting ran past the lab's {TURNS} turns")
    checked = [q for t in turns for q in t["quotes"]]
    completed = artifact.get("completed_at")
    return {"schema": SCHEMA, "kind": "meeting", "request_id": request_id,
            "meeting_id": f"rain-model-{session}", "question": question, "generation": "model",
            "engine": MODEL_ENGINE, "model": model, "grounding": None, "matched_terms": None,
            "missing_terms": None, "turns": turns, "verdict": None,
            "audit": {"checked": len(checked), "verified": sum(q["verified"] for q in checked),
                      "corpus_files": len(rows), "corpus_sha256": fingerprint.hexdigest()},
            "suggestions": [], "rain": revision,
            "produced_at": completed if isinstance(completed, str) and completed else now_iso(),
            "source_artifact": {"schema": ARTIFACT_SCHEMA, "session_id": session,
                                "status": artifact["status"],
                                "sha256": hashlib.sha256(raw).hexdigest()}}


class ModelMeetings:
    """james_library's own model meeting, one at a time, as jobs the lab checks on."""

    def __init__(self, library: Library, *, python: str, base_url: str, model: str,
                 turns: int, timeout_s: int, recursion: bool, token_env: str):
        self.library, self.python, self.base_url, self.model = library, python, base_url, model
        self.turns, self.timeout_s, self.recursion, self.token_env = turns, timeout_s, recursion, token_env
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()

    def environment(self) -> dict[str, str]:
        """The meeting's environment: no TypeSafe key, no bridge token, nothing that
        lets the meeting consult a decision engine or speak, and UTF-8 output."""
        # Compared in upper case: Windows environment names are case-insensitive.
        drop = {"TYPESAFE_API_KEY", self.token_env.upper()}
        env = {k: v for k, v in os.environ.items() if k.upper() not in drop}
        env.update(RAIN_DECISION_MODE="off", RAIN_METACOGNITIVE_CONTROL="false",
                   RAIN_DECISION_REMOTE_ALLOWED="false", RAIN_VISUAL_EVENTS="0",
                   RAIN_EXPORT_TTS_AUDIO="0", RAIN_USE_RUST_DAEMON="0",
                   RAIN_LLM_BASE_URL=self.base_url, RAIN_LLM_MODEL=self.model,
                   PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
        return env

    def start(self, question: str, request: str) -> dict[str, Any]:
        with self.lock:
            self._purge()
            if any(j["state"] == "running" for j in self.jobs.values()):
                raise Refused(422, "R.A.I.N. is already holding a meeting; wait for it or stop it")
            revision = self.library.revision()
            if not revision["commit"]:
                raise Refused(422, "the james_library checkout's commit is unknown; "
                                   "a model meeting runs R.A.I.N. at a commit")
            job_id = secrets.token_hex(16)
            job = {"id": job_id, "request_id": request, "question": question, "state": "running",
                   "started": time.monotonic(), "started_at": now_iso(), "ended": None,
                   "turns_started": 0, "record": None, "reason": None, "process": None,
                   "log": None, "cancelled": False,
                   "revision": {**revision, "dirty": False}}  # the copy is the clean commit
            self.jobs[job_id] = job
        threading.Thread(target=self._run, args=(job,), daemon=True).start()
        return self._pending(job)

    def status(self, job_id: str, request: str) -> dict[str, Any]:
        job = self.jobs.get(job_id)
        if job is None or job["request_id"] != request:
            raise Refused(422, "no such meeting")
        if job["state"] == "running":
            return self._pending(job)
        if job["state"] == "done":
            return job["record"]
        return self._failed(job)

    def cancel(self, job_id: str, request: str) -> dict[str, Any]:
        job = self.jobs.get(job_id)
        if job is None or job["request_id"] != request:
            raise Refused(422, "no such meeting")
        if job["state"] == "running":
            job["cancelled"] = True
            proc = job["process"]
            if proc is not None and proc.poll() is None:
                proc.kill()
            job["state"], job["reason"], job["ended"] = "failed", "stopped at the lab's request", time.monotonic()
        return self._failed(job)

    def _pending(self, job: dict[str, Any]) -> dict[str, Any]:
        log = job["log"]
        if log is not None and log.is_file():
            try:
                job["turns_started"] = len(TURN_STARTED.findall(log.read_text(encoding="utf-8", errors="ignore")))
            except OSError:
                pass
        return {"schema": SCHEMA, "kind": "meeting-pending", "request_id": job["request_id"],
                "job_id": job["id"], "question": job["question"], "model": self.model,
                "started_at": job["started_at"],
                "elapsed_s": round(time.monotonic() - job["started"], 1),
                "turns_started": min(job["turns_started"], TURNS), "turns_planned": self.turns}

    def _failed(self, job: dict[str, Any]) -> dict[str, Any]:
        return {"schema": SCHEMA, "kind": "meeting-failed", "request_id": job["request_id"],
                "job_id": job["id"], "reason": (job["reason"] or "the meeting ended without a record")[:300]}

    def _purge(self) -> None:
        now = time.monotonic()
        for key in [k for k, j in self.jobs.items()
                    if j["ended"] is not None and now - j["ended"] > KEEP_FINISHED_S]:
            del self.jobs[key]
        while len(self.jobs) > 8:
            oldest = min((k for k, j in self.jobs.items() if j["state"] != "running"),
                         key=lambda k: self.jobs[k]["started"], default=None)
            if oldest is None:
                break
            del self.jobs[oldest]

    def _run(self, job: dict[str, Any]) -> None:
        work = Path(tempfile.mkdtemp(prefix="rain-bethesda-meeting-"))
        try:
            archive(self.library.root, job["revision"]["commit"], work)
            artifacts = work / "meeting_archives" / "session_artifacts"
            before = set(artifacts.glob("session_*.json")) if artifacts.is_dir() else set()
            job["log"] = work / "rain-bethesda-bridge-meeting.log"
            argv = [self.python, str(work / MEETING_SCRIPT), "--library", str(work),
                    "--topic", job["question"], "--max-turns", str(self.turns), "--no-web",
                    "--model", self.model, "--base-url", self.base_url,
                    "--no-export-tts-audio", "--no-emit-visual-events"]
            if not self.recursion:
                argv.append("--no-recursive-intellect")
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
            with open(job["log"], "wb") as log:
                # stdin is a pipe nobody writes: R.A.I.N.'s "press ENTER to speak"
                # window sees no key, so no founder ever intervenes.
                proc = subprocess.Popen(argv, cwd=work, env=self.environment(), stdin=subprocess.PIPE,
                                        stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
                job["process"] = proc
                if job["cancelled"]:
                    proc.kill()
                try:
                    code = proc.wait(timeout=self.timeout_s)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
                    raise MeetingFailed(f"R.A.I.N.'s meeting did not finish in {self.timeout_s // 60} minutes")
                finally:
                    if proc.stdin:
                        proc.stdin.close()
            self._pending(job)  # last progress count, read before the copy goes
            if job["cancelled"]:
                return
            if code == 2:
                raise MeetingFailed("R.A.I.N. refused the meeting's model endpoint under its [rig] privacy rule")
            if code != 0:
                raise MeetingFailed(f"R.A.I.N.'s meeting exited with status {code}")
            new = sorted(set(artifacts.glob("session_*.json")) - before) if artifacts.is_dir() else []
            if len(new) != 1:
                raise MeetingFailed("R.A.I.N. kept no record of a meeting: is the model server running at "
                                    f"{self.base_url} with the model {self.model}?")
            stopped = bool(MODEL_STOPPED.search(job["log"].read_text(encoding="utf-8", errors="ignore")))
            try:
                record = model_meeting_record(work, new[0], job["question"], job["request_id"],
                                              job["revision"], self.library.corpus, model_stopped=stopped)
            except MeetingFailed as exc:
                if not stopped:
                    raise
                raise MeetingFailed(f"{exc}: check that {self.base_url} is serving {self.model}, and "
                                    "that the model's context length is at least 16,384 tokens") from exc
            if not job["cancelled"]:
                job["record"], job["state"] = record, "done"
        except MeetingFailed as exc:
            if not job["cancelled"]:
                job["state"], job["reason"] = "failed", str(exc)
        except Exception as exc:  # noqa: BLE001 - the lab gets a reason, never a traceback
            sys.stderr.write(f"model meeting error: {type(exc).__name__}\n")
            if not job["cancelled"]:
                job["state"], job["reason"] = "failed", "the bridge could not read R.A.I.N.'s meeting"
        finally:
            if job["ended"] is None:
                job["ended"] = time.monotonic()
            shutil.rmtree(work, ignore_errors=True)


def attempt(a: dict[str, Any]) -> dict[str, Any]:
    """One engine R.A.I.N. consulted, as its envelope recorded it."""
    reason = a.get("reason")
    return {"engine": a.get("engine"), "model": a.get("model"), "selected": a.get("selected"),
            "probabilities": [[str(k), float(v)] for k, v in (a.get("probabilities") or ())],
            "confidence": a.get("confidence"),
            "reason": reason.value if hasattr(reason, "value") else reason,
            "error_code": a.get("error_code"), "latency_ms": a.get("latency_ms")}


class Bridge:
    def __init__(self, library: Library, registry_root: Path, scratch: bool, *,
                 meetings: ModelMeetings | None = None, remote_decisions: bool = False):
        self.library, self.registry_root, self.scratch = library, registry_root, scratch
        self.meetings, self.remote_decisions = meetings, remote_decisions
        self.lock = threading.Lock()  # one registry writer at a time

    def identity(self) -> dict[str, Any]:
        m = self.meetings
        return {"schema": SCHEMA, "kind": "identity", "bridge": BRIDGE,
                "rain": self.library.revision(), "corpus": self.library.corpus_identity(),
                "meeting_engine": MODEL_ENGINE if m else ENGINE,
                "meeting_generation": "model" if m else "scripted", "model": m.model if m else None,
                "bounded_decision": (os.environ.get("RAIN_DECISION_MODE") or "off")[:32],
                "remote_decisions": self.remote_decisions,
                "registry": {"available": True, "scratch": self.scratch}}

    def meeting(self, body: dict[str, Any]) -> dict[str, Any]:
        closed(body, {"schema", "kind", "request_id", "question"}, "meeting-request")
        question = " ".join(text(body["question"], 500).split())
        if not question:
            raise Refused(400, "empty question")
        if self.meetings is not None:
            return self.meetings.start(question, request_id(body))
        return meeting_record(self.library, question, request_id(body))

    def meeting_status(self, body: dict[str, Any]) -> dict[str, Any]:
        closed(body, {"schema", "kind", "request_id", "job_id"}, "meeting-status-request")
        if self.meetings is None:
            raise Refused(422, "this bridge holds no model meetings")
        return self.meetings.status(job_id(body), request_id(body))

    def meeting_cancel(self, body: dict[str, Any]) -> dict[str, Any]:
        closed(body, {"schema", "kind", "request_id", "job_id"}, "meeting-cancel-request")
        if self.meetings is None:
            raise Refused(422, "this bridge holds no model meetings")
        return self.meetings.cancel(job_id(body), request_id(body))

    def proposal(self, body: dict[str, Any]) -> dict[str, Any]:
        closed(body, {"schema", "kind", "request_id", "question", "options"}, "proposal-request")
        from james_library.judgment.config import create_decision_router  # noqa: PLC0415
        from james_library.judgment.routing import DecisionRequest  # noqa: PLC0415

        options = body["options"]
        if not isinstance(options, list) or not 2 <= len(options) <= 16:
            raise Refused(400, "expected 2 to 16 host options")
        choices = []
        for option in options:
            if not isinstance(option, dict) or set(option) != {"id", "description"} \
                    or not isinstance(option["id"], str) or not OPTION_ID.match(option["id"]):
                raise Refused(400, "invalid option")
            choices.append((option["id"], text(option["description"], 500)))
        if len(dict(choices)) != len(choices):
            raise Refused(400, "duplicate options")
        request = DecisionRequest(
            decision_class="bethesda_experiment",
            state="Research question: " + text(body["question"], 500),
            instructions="Which of these host-defined Bethesda simulation experiments, if any, "
                         "would test the research question?",
            # The question goes to a remote engine (Jev) only when the operator
            # said so, with R.A.I.N.'s own RAIN_DECISION_REMOTE_ALLOWED.
            choices=tuple(choices), consequence="low", remote_allowed=self.remote_decisions)
        offered = set(dict(choices))
        envelope = create_decision_router().decide(
            request, validator=lambda req, selected: selected is None or selected in offered)
        payload = envelope.to_dict()
        return {"schema": SCHEMA, "kind": "proposal-choice", "request_id": request_id(body),
                "decision": {"schema_version": payload["schema_version"],
                             "decision_id": payload["decision_id"],
                             "destination": payload["destination"], "selected": payload["selected"],
                             "reason": payload["reason"].value if payload["reason"] else None,
                             "envelope_hash": payload["envelope_hash"],
                             "attempts": [attempt(a) for a in payload["attempts"]][:4],
                             "latency_ms": payload["latency_ms"]}}

    def preregister(self, body: dict[str, Any]) -> dict[str, Any]:
        closed(body, {"schema", "kind", "request_id", "draft"}, "preregister-request")
        from james_library.experiments.registry import Registry  # noqa: PLC0415
        from james_library.experiments.schema import ExperimentError, sha256_json  # noqa: PLC0415

        draft = body["draft"]
        if not isinstance(draft, dict) or set(draft) != DRAFT_FIELDS:
            raise Refused(400, "draft must carry exactly the create --from fields")
        if draft.get("runner", {}).get("kind") != "external" or draft.get("evidence_class") != "simulated":
            raise Refused(400, "only external, simulated experiments are registered here")
        with self.lock:
            try:
                definition = Registry(self.registry_root).create(draft)
            except ExperimentError as exc:
                raise Refused(422, "R.A.I.N. refused the definition: " + str(exc)[:300]) from exc
        return {"schema": SCHEMA, "kind": "preregistration", "request_id": request_id(body),
                "experiment_id": definition["experiment_id"],
                "experiment_version": definition["experiment_version"],
                "definition_sha256": sha256_json(definition), "created_at": definition["created_at"],
                "registry": "scratch" if self.scratch else "configured"}

    def submission(self, body: dict[str, Any]) -> dict[str, Any]:
        closed(body, {"schema", "kind", "request_id", "experiment_id", "submission"},
               "submission-request")
        from james_library.experiments.registry import Registry  # noqa: PLC0415
        from james_library.experiments.runner import record_submission  # noqa: PLC0415
        from james_library.experiments.schema import ExperimentError  # noqa: PLC0415

        experiment_id = body["experiment_id"]
        if not isinstance(experiment_id, str) or not EXPERIMENT_ID.match(experiment_id):
            raise Refused(400, "invalid experiment id")
        with self.lock:
            try:
                record = record_submission(Registry(self.registry_root), experiment_id,
                                           body["submission"])
            except ExperimentError as exc:
                raise Refused(422, "R.A.I.N. refused the submission: " + str(exc)[:300]) from exc
        return {"schema": SCHEMA, "kind": "admission", "request_id": request_id(body),
                "run_id": record["run_id"], "status": record["status"],
                "hypothesis_verdict": record["hypothesis_verdict"],
                "evaluation": record["evaluation"],
                "interpretation": {"deterministic": record["interpretation"]["deterministic"],
                                   "model": None},
                "definition_sha256": record["definition_sha256"],
                "recorded_at": record["provenance"]["recorded_at"]}


def closed(body: dict[str, Any], keys: set[str], kind: str) -> None:
    if set(body) != keys or body.get("schema") != SCHEMA or body.get("kind") != kind:
        raise Refused(400, "unexpected fields, schema or kind")


def request_id(body: dict[str, Any]) -> str:
    value = body.get("request_id")
    if not isinstance(value, str) or not HEX32.match(value):
        raise Refused(400, "invalid request id")
    return value


def job_id(body: dict[str, Any]) -> str:
    value = body.get("job_id")
    if not isinstance(value, str) or not HEX32.match(value):
        raise Refused(400, "invalid job id")
    return value


def make_handler(bridge: Bridge, token: str | None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "rain-bethesda-bridge/2"
        sys_version = ""

        def log_message(self, fmt: str, *args: Any) -> None:  # no bodies, no headers
            sys.stderr.write(f"{self.command} {self.path.split('?')[0]} -> {args[1] if len(args) > 1 else ''}\n")

        def reply(self, status: int, payload: dict[str, Any]) -> None:
            data = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def authorized(self) -> bool:
            if token is None:
                return True
            sent = self.headers.get("Authorization", "")
            return hmac.compare_digest(sent.encode(), f"Bearer {token}".encode())

        def do_GET(self) -> None:  # noqa: N802 - http.server API
            if not self.authorized():
                return self.reply(401, {"schema": SCHEMA, "kind": "error", "error": "unauthorized"})
            if self.path != PREFIX + "/identity":
                return self.reply(404, {"schema": SCHEMA, "kind": "error", "error": "not found"})
            self.reply(200, bridge.identity())

        def do_POST(self) -> None:  # noqa: N802 - http.server API
            if not self.authorized():
                return self.reply(401, {"schema": SCHEMA, "kind": "error", "error": "unauthorized"})
            op = self.path[len(PREFIX) + 1:] if self.path.startswith(PREFIX + "/") else ""
            if op not in REQUEST_LIMITS:
                return self.reply(404, {"schema": SCHEMA, "kind": "error", "error": "not found"})
            if "application/json" not in (self.headers.get("Content-Type") or ""):
                return self.reply(415, {"schema": SCHEMA, "kind": "error", "error": "JSON required"})
            try:
                length = int(self.headers.get("Content-Length") or "-1")
            except ValueError:
                length = -1
            if length < 0 or length > REQUEST_LIMITS[op]:
                return self.reply(413, {"schema": SCHEMA, "kind": "error", "error": "body too large"})
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(body, dict):
                    raise Refused(400, "expected an object")
                self.reply(200, getattr(bridge, op.replace("-", "_"))(body))
            except Refused as exc:
                self.reply(exc.status, {"schema": SCHEMA, "kind": "error", "error": exc.code})
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.reply(400, {"schema": SCHEMA, "kind": "error", "error": "invalid JSON"})
            except Exception as exc:  # noqa: BLE001 - never leak a traceback to the caller
                sys.stderr.write(f"bridge error in {op}: {type(exc).__name__}\n")
                self.reply(500, {"schema": SCHEMA, "kind": "error", "error": "bridge error"})

    return Handler


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--library", required=True, help="path to a james_library checkout")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--registry", help="R.A.I.N. experiment registry directory "
                                           "(default: a new scratch directory)")
    parser.add_argument("--token-env", default="RAIN_BRIDGE_TOKEN",
                        help="environment variable holding an optional bearer token")
    parser.add_argument("--allow-remote", action="store_true",
                        help="permit binding a non-loopback address")
    meeting = parser.add_argument_group(
        "model meetings", "run james_library's own model meeting (rain_lab_meeting_chat_version.py) "
        "against the local model R.A.I.N. is configured for: RAIN_LLM_BASE_URL and RAIN_LLM_MODEL, "
        "or [rig.meeting] in R.A.I.N.'s config")
    meeting.add_argument("--meeting-engine", choices=("offline", "model"), default="offline",
                         help="offline: R.A.I.N.'s offline engine (default); model: its model meeting")
    meeting.add_argument("--meeting-python", default=sys.executable,
                         help="the Python with james_library's requirements installed (default: this one)")
    meeting.add_argument("--meeting-turns", type=int, default=25,
                         help="R.A.I.N.'s --max-turns, 1 to 30 (default 25, R.A.I.N.'s own)")
    meeting.add_argument("--meeting-timeout", type=int, default=45,
                         help="minutes before an unfinished meeting is stopped, 5 to 60 (default 45); "
                              "the lab waits on a meeting for at most 60")
    meeting.add_argument("--meeting-no-recursion", action="store_true",
                         help="pass R.A.I.N.'s --no-recursive-intellect (fewer model calls per turn)")
    args = parser.parse_args(argv)
    if args.host not in {"127.0.0.1", "::1", "localhost"} and not args.allow_remote:
        parser.error("refusing a non-loopback bind without --allow-remote")
    library = Library(Path(args.library))
    scratch = args.registry is None
    registry = Path(args.registry) if args.registry else Path(tempfile.mkdtemp(prefix="rain-bethesda-registry-"))
    token = os.environ.get(args.token_env) or None
    # Whether a decision's question may go to a remote engine is R.A.I.N.'s own
    # setting, read by R.A.I.N.'s own parser; anything but true or false stops here.
    from james_library.judgment.config import enabled  # noqa: PLC0415 - needs sys.path
    try:
        remote_decisions = enabled("RAIN_DECISION_REMOTE_ALLOWED")
    except ValueError as exc:
        parser.error(str(exc))
    meetings = None
    if args.meeting_engine == "model":
        if not 1 <= args.meeting_turns <= 30:
            parser.error("--meeting-turns must be 1 to 30")
        if not 5 <= args.meeting_timeout <= 60:  # the lab's LIMITS.meetingJobMinutes
            parser.error("--meeting-timeout must be 5 to 60 minutes")
        if not (library.root / MEETING_SCRIPT).is_file():
            parser.error(f"{library.root} has no {MEETING_SCRIPT}")
        from james_library.utilities.rig_settings import (  # noqa: PLC0415
            RigPrivacyError, enforce_meeting_privacy, meeting_base_url, meeting_model)
        base_url = meeting_base_url("http://127.0.0.1:11434/v1")
        model = meeting_model("")
        if not model or not MODEL_ID.match(model):
            parser.error("set RAIN_LLM_MODEL (or [rig.meeting] model) to the local model to run, "
                         "for example qwen2.5:7b in Ollama or qwen2.5-7b-instruct in LM Studio")
        try:  # R.A.I.N.'s own rule, checked before the first meeting
            enforce_meeting_privacy(base_url, model)
        except RigPrivacyError as exc:
            parser.error(str(exc))
        check = subprocess.run([args.meeting_python, "-c", "import openai, numpy, networkx, sklearn"],
                               capture_output=True, timeout=120)
        if check.returncode != 0:
            parser.error(f"{args.meeting_python} lacks james_library's requirements "
                         "(pip install -r requirements.txt in that environment)")
        meetings = ModelMeetings(library, python=args.meeting_python, base_url=base_url, model=model,
                                 turns=args.meeting_turns, timeout_s=args.meeting_timeout * 60,
                                 recursion=not args.meeting_no_recursion, token_env=args.token_env)
    bridge = Bridge(library, registry, scratch, meetings=meetings, remote_decisions=remote_decisions)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(bridge, token))
    revision = library.revision()
    print(f"rain-bethesda bridge on http://{args.host}:{server.server_address[1]}{PREFIX} "
          f"· james_library {revision['commit'] or 'unknown'} · registry "
          f"{'scratch ' if scratch else ''}{registry} · token {'required' if token else 'off'}",
          flush=True)
    print(f"meetings: {'model ' + meetings.model + ' at ' + meetings.base_url if meetings else 'offline engine'}"
          f" · decisions: {(os.environ.get('RAIN_DECISION_MODE') or 'off')[:32]}"
          f"{', remote engines allowed' if remote_decisions else ''}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
