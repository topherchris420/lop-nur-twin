"""Operator-owned, local institutional journal. Agents use the service boundary."""
from contextlib import contextmanager
from dataclasses import dataclass
from hashlib import sha256
from hmac import compare_digest
import json
import os
from pathlib import Path
import re
import sqlite3
import time

SCHEMA = "rain-institutional-memory/v1"
ZERO = "0" * 64
ROLES = {"researcher", "instrument", "verifier", "reviewer", "reader"}
KINDS = {
    "hypothesis": "researcher", "prediction": "researcher", "protocol": "researcher",
    "question": "researcher", "disagreement": "researcher", "handoff": "researcher",
    "receipt": "researcher", "correction": "researcher", "guidance": "researcher",
    "observation": "instrument", "software": "instrument",
    "outcome": "verifier", "decision": "reviewer",
}
IDENTIFIER = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}")
DIGEST = re.compile(r"[a-f0-9]{64}")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return sha256(canonical(value).encode()).hexdigest()


def words(text):
    return set(re.findall(r"\w+", text.casefold()))


def rank(records, query, limit):
    terms = words(query)
    candidates = []
    for record in records:
        event = record["event"]
        overlap = terms & words(f'{event["subject"]} {event["text"]}')
        if overlap:
            candidates.append((len(overlap), record["seq"], record))
    return [item[2] for item in sorted(candidates, reverse=True)[:limit]]


@dataclass(frozen=True)
class Principal:
    name: str
    role: str


class Credentials:
    """Store only SHA-256 digests of operator-issued 256-bit random tokens."""
    def __init__(self, policy):
        self.entries = []
        seen = set()
        for name, row in policy.items():
            fingerprint = row["token_sha256"]
            if not IDENTIFIER.fullmatch(name) or row["role"] not in ROLES or not DIGEST.fullmatch(fingerprint):
                raise ValueError("Invalid credential configuration")
            if fingerprint in seen:
                raise ValueError("Credentials must have separate tokens")
            seen.add(fingerprint)
            self.entries.append((fingerprint, Principal(name, row["role"])))

    def authenticate(self, token):
        if not isinstance(token, str) or not DIGEST.fullmatch(token):
            raise PermissionError("Credential required")
        fingerprint = sha256(token.encode()).hexdigest()
        for expected, principal in self.entries:
            if compare_digest(expected, fingerprint):
                return principal
        raise PermissionError("Invalid credential")


class Journal:
    """One workspace per database. The filesystem is private to the operator."""
    def __init__(self, path):
        self.path = Path(path)
        if self.path.is_symlink():
            raise ValueError("Journal cannot be a symlink")
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            os.close(fd)
        if not self.path.is_file() or self.path.stat().st_mode & 0o077:
            raise ValueError("Journal must be an owner-only regular file")
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version == 0:
                if db.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone() is not None:
                    raise ValueError("Refusing to initialize a nonempty unversioned database")
                db.execute("""CREATE TABLE journal (
                    seq INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, prev TEXT NOT NULL,
                    actor TEXT NOT NULL, role TEXT NOT NULL, recorded_ns INTEGER NOT NULL,
                    event TEXT NOT NULL, UNIQUE(actor, event)
                )""")
                for operation in ("UPDATE", "DELETE"):
                    db.execute(f"""CREATE TRIGGER reject_{operation} BEFORE {operation} ON journal
                                   BEGIN SELECT RAISE(ABORT, 'append only'); END""")
                db.execute("PRAGMA user_version = 1")
            elif version != 1:
                raise ValueError("Unsupported journal schema")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute("PRAGMA trusted_schema = OFF")
            db.execute("PRAGMA synchronous = FULL")
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _read(db):
        records = []
        by_hash = {}
        prev = ZERO
        for seq, checksum, predecessor, actor, role, timestamp, raw in db.execute(
            "SELECT seq, hash, prev, actor, role, recorded_ns, event FROM journal ORDER BY seq"
        ):
            record = {"schema": SCHEMA, "seq": seq, "prev": predecessor, "actor": actor, "role": role,
                      "recorded_ns": timestamp, "event": json.loads(raw)}
            expected = digest(record)
            if seq != len(records) + 1 or prev != predecessor or checksum != expected:
                raise ValueError(f"Journal integrity failure at event {seq}")
            validate(Principal(actor, role), record["event"], by_hash)
            record["hash"] = checksum
            records.append(record)
            by_hash[checksum] = record
            prev = checksum
        return records, by_hash

    def snapshot(self, checkpoint=None):
        with self.connection() as db:
            records, by_hash = self._read(db)
        if checkpoint is not None and checkpoint != ZERO and checkpoint not in by_hash:
            raise ValueError("Journal does not extend the trusted checkpoint")
        return records

    def append(self, principal, event):
        raw = canonical(event)
        event = json.loads(raw)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            records, by_hash = self._read(db)
            for record in records:
                if record["actor"] == principal.name and record["role"] == principal.role and record["event"] == event:
                    return record
            validate(principal, event, by_hash)
            prev = records[-1]["hash"] if records else ZERO
            record = {"schema": SCHEMA, "seq": len(records) + 1, "prev": prev, "actor": principal.name,
                      "role": principal.role, "recorded_ns": time.time_ns(), "event": event}
            checksum = digest(record)
            db.execute("INSERT INTO journal VALUES (?, ?, ?, ?, ?, ?, ?)",
                       (record["seq"], checksum, prev, principal.name, principal.role, record["recorded_ns"], raw))
        return {**record, "hash": checksum}

    def recall(self, query, *, limit=12):
        if not isinstance(query, str) or not 1 <= len(query) <= 300 or not 1 <= limit <= 30:
            raise ValueError("Invalid query or result limit")
        return rank(self.snapshot(), query, limit)

    def backup(self, destination):
        destination = Path(destination)
        with self.connection() as source:
            self._read(source)
            fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
            try:
                target = sqlite3.connect(destination)
                try:
                    source.backup(target)
                    records, _ = self._read(target)
                finally:
                    target.close()
            except BaseException:
                destination.unlink()
                raise
        return records[-1]["hash"] if records else ZERO


def validate(principal, event, by_hash):
    required = {"kind", "subject", "text", "refs", "data"}
    if not isinstance(event, dict) or set(event) != required or len(canonical(event).encode()) > 16000:
        raise ValueError("Invalid event envelope")
    kind, subject, text, refs, data = (event[k] for k in ("kind", "subject", "text", "refs", "data"))
    if not isinstance(kind, str) or KINDS.get(kind) != principal.role:
        raise PermissionError("This role cannot append that record type")
    if not IDENTIFIER.fullmatch(principal.name) or not isinstance(subject, str) or not IDENTIFIER.fullmatch(subject):
        raise ValueError("Invalid actor or subject")
    if not isinstance(text, str) or not text.strip() or not isinstance(data, dict):
        raise ValueError("Invalid event text or data")
    if (not isinstance(refs, list) or len(refs) > 16 or not all(isinstance(ref, str) and ref in by_hash for ref in refs)
            or len(set(refs)) != len(refs)):
        raise ValueError("References must identify unique earlier events")
    parents = [by_hash[ref] for ref in refs]
    if any(parent["event"]["subject"] != subject for parent in parents):
        raise ValueError("References must stay within the investigation")
    parent_kinds = [parent["event"]["kind"] for parent in parents]

    if kind in {"prediction", "protocol", "disagreement", "handoff", "observation", "outcome",
                "receipt", "correction", "decision"} and not parents:
        raise ValueError("This record requires provenance")
    if kind == "handoff" and (set(data) != {"assignee", "question"} or
            not isinstance(data["assignee"], str) or not IDENTIFIER.fullmatch(data["assignee"])
            or not isinstance(data["question"], str) or not data["question"].strip()):
        raise ValueError("A handoff requires an assignee and unresolved question")
    if kind == "receipt" and (parent_kinds != ["handoff"]
            or parents[0]["event"]["data"]["assignee"] != principal.name or data):
        raise PermissionError("Only an assigned researcher may acknowledge a handoff")
    if kind == "observation" and ("protocol" not in parent_kinds or not atlas_ref(data)):
        raise ValueError("Observation requires a protocol and a verified ATLAS reference")
    if kind == "outcome":
        if (not atlas_ref(data) or data.get("verdict") not in {"refuted", "compatible", "inconclusive"}
                or parent_kinds != ["observation"]):
            raise ValueError("Outcome requires an independently evaluated ATLAS observation")
        if parents[0]["actor"] == principal.name:
            raise PermissionError("An instrument cannot verify its own observation")
        if parents[0]["event"]["data"]["ledger"] != data["ledger"]:
            raise ValueError("Observation and outcome must share an ATLAS checkpoint")
    if kind == "correction":
        if parent_kinds.count("hypothesis") != 1 or parent_kinds.count("outcome") != 2:
            raise ValueError("Correction requires an original hypothesis and two outcomes")
        outcome_events = [p["event"] for p in parents if p["event"]["kind"] == "outcome"]
        outcomes = [outcome["data"] for outcome in outcome_events]
        observations = [by_hash[outcome["refs"][0]] for outcome in outcome_events]
        protocols = [
            {ref for ref in observation["event"]["refs"] if by_hash[ref]["event"]["kind"] == "protocol"}
            for observation in observations
        ]
        hypothesis = next(p["hash"] for p in parents if p["event"]["kind"] == "hypothesis")
        if (len(protocols[0]) != 1 or protocols[0] != protocols[1]
                or hypothesis not in by_hash[next(iter(protocols[0]))]["event"]["refs"]
                or len({observation["event"]["data"]["object"] for observation in observations}) != 2):
            raise ValueError("Outcomes must test the same preregistered hypothesis on distinct measurements")
        if (
            {(o.get("phase"), o["verdict"]) for o in outcomes}
            != {("discovery", "refuted"), ("replication", "compatible")}
            or len({o["object"] for o in outcomes}) != 2
        ):
            raise ValueError("Correction requires refutation and a distinct replication")
    if kind == "decision":
        if (parent_kinds not in (["correction"], ["guidance"]) or set(data) != {"disposition"}
                or data["disposition"] not in {"approve", "reject", "revoke"}):
            raise ValueError("Invalid review decision")
        if parents[0]["actor"] == principal.name:
            raise PermissionError("Authors cannot review their own proposal")


def atlas_ref(data):
    return all(isinstance(data.get(key), str) and DIGEST.fullmatch(data[key]) for key in ("ledger", "object"))


def event(kind, subject, text, refs=(), **data):
    return {"kind": kind, "subject": subject, "text": text,
            "refs": [r["hash"] if isinstance(r, dict) else r for r in refs], "data": data}


def standing(records):
    """Project the latest review per proposal; preserve every original event."""
    decisions = {}
    for row in records:
        item = row["event"]
        if item["kind"] == "decision":
            decisions[item["refs"][0]] = item["data"]["disposition"]
    return decisions


def pending(records, assignee):
    completed = {row["event"]["refs"][0] for row in records if row["event"]["kind"] == "receipt"}
    return [row for row in records if row["event"]["kind"] == "handoff"
            and row["event"]["data"]["assignee"] == assignee and row["hash"] not in completed]
