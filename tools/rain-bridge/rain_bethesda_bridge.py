#!/usr/bin/env python3
"""R.A.I.N.-side adapter for the ``rain-bethesda/v1`` protocol.

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
``POST .../proposal``  ``judgment.config.create_decision_router().decide`` on
                       the host's own explicit options (``rain-bounded-request``
                       semantics). With ``RAIN_DECISION_MODE=off`` (the
                       default) the router proposes nothing and says DISABLED.
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
* No shell. The only subprocess is ``git`` with a fixed argument list.
* The registry defaults to a fresh scratch directory: the committed
  ``experiments/`` registry is written only when ``--registry`` names it.
* Standard library only, so it runs wherever james_library's offline demo does.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

SCHEMA = "rain-bethesda/v1"
BRIDGE = {"name": "rain-bethesda-bridge", "version": "1"}
PREFIX = "/rain-bethesda/v1"
REQUEST_LIMITS = {"meeting": 4 * 1024, "proposal": 16 * 1024, "preregister": 64 * 1024,
                  "submission": 256 * 1024}
HEX32 = re.compile(r"^[0-9a-f]{32}$")
OPTION_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
EXPERIMENT_ID = re.compile(r"^V3D-EXP-[0-9]{4,}$")
UNSAFE_TEXT = re.compile("[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]")
ENGINE = "james_library.launcher.offline_meeting.build_offline_meeting"
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
    """Run R.A.I.N.'s offline engine and express its meeting in rain-bethesda/v1."""
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
              "quotes": [quote(q) for q in t.quotes], "coda": t.coda, "unverified": 0}
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
            **content, "rain": library.revision(), "produced_at": now_iso()}


class Bridge:
    def __init__(self, library: Library, registry_root: Path, scratch: bool):
        self.library, self.registry_root, self.scratch = library, registry_root, scratch
        self.lock = threading.Lock()  # one registry writer at a time

    def identity(self) -> dict[str, Any]:
        return {"schema": SCHEMA, "kind": "identity", "bridge": BRIDGE,
                "rain": self.library.revision(), "corpus": self.library.corpus_identity(),
                "meeting_engine": ENGINE, "meeting_generation": "scripted", "model": None,
                "bounded_decision": (os.environ.get("RAIN_DECISION_MODE") or "off")[:32],
                "registry": {"available": True, "scratch": self.scratch}}

    def meeting(self, body: dict[str, Any]) -> dict[str, Any]:
        closed(body, {"schema", "kind", "request_id", "question"}, "meeting-request")
        question = " ".join(text(body["question"], 500).split())
        if not question:
            raise Refused(400, "empty question")
        return meeting_record(self.library, question, request_id(body))

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
            choices=tuple(choices), consequence="low", remote_allowed=False)
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
                             "attempts": len(payload["attempts"]),
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


def make_handler(bridge: Bridge, token: str | None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "rain-bethesda-bridge/1"
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
                self.reply(200, getattr(bridge, op)(body))
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
    args = parser.parse_args(argv)
    if args.host not in {"127.0.0.1", "::1", "localhost"} and not args.allow_remote:
        parser.error("refusing a non-loopback bind without --allow-remote")
    library = Library(Path(args.library))
    scratch = args.registry is None
    registry = Path(args.registry) if args.registry else Path(tempfile.mkdtemp(prefix="rain-bethesda-registry-"))
    token = os.environ.get(args.token_env) or None
    bridge = Bridge(library, registry, scratch)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(bridge, token))
    revision = library.revision()
    print(f"rain-bethesda bridge on http://{args.host}:{server.server_address[1]}{PREFIX} "
          f"· james_library {revision['commit'] or 'unknown'} · registry "
          f"{'scratch ' if scratch else ''}{registry} · token {'required' if token else 'off'}",
          flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
