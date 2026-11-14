from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from evaluation import evaluate
from mcp_bridge import dispatch as mcp_dispatch
from memory import Credentials, Journal, Principal, digest, event, pending, standing
from service import dispatch
from sources import Anna, gbrain_search, loopback
from view import wiki

A, B = Principal("jasmine", "researcher"), Principal("elena", "researcher")


class InstitutionalMemoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "journal.sqlite"
        self.journal = Journal(self.path)

    def append(self, kind, refs=(), principal=A, **data):
        return self.journal.append(principal, event(kind, "study", f"Example {kind}", refs, **data))

    def test_permissions_and_assignment_survive_restart(self):
        hypothesis = self.append("hypothesis")
        handoff = self.append("handoff", [hypothesis], assignee=B.name, question="Can we replicate?")
        reopened = Journal(self.path)
        self.assertEqual(pending(reopened.snapshot(), B.name), [handoff])
        self.assertEqual(dispatch(reopened, B, "resume", {}), [{"handoff": handoff, "sources": [hypothesis]}])
        with self.assertRaises(PermissionError):
            self.append("receipt", [handoff])
        with self.assertRaises(PermissionError):
            dispatch(reopened, B, "append", event("outcome", "study", "Fake grade", [handoff]))
        self.append("receipt", [handoff], principal=B)
        self.assertEqual(pending(reopened.snapshot(), B.name), [])
        self.assertIn(hypothesis["hash"], wiki(reopened.snapshot())["study"])

    def test_concurrent_and_retried_writes_extend_the_same_chain(self):
        def write(index):
            return Journal(self.path).append(A, event("question", "study", f"Question {index}"))
        with ThreadPoolExecutor(max_workers=8) as pool:
            outcomes = list(pool.map(write, list(range(18)) * 2))
        records = self.journal.snapshot()
        self.assertEqual(len(records), 18)
        self.assertEqual(outcomes[:18], outcomes[18:])
        self.assertEqual({r["seq"] for r in records}, set(range(1, 19)))

    def test_backup_and_owner_tampering(self):
        self.append("hypothesis")
        backup = self.path.with_name("backup.sqlite")
        head = self.journal.backup(backup)
        self.append("question")
        self.assertEqual(len(self.journal.snapshot(head)), 2)
        self.assertEqual(len(Journal(backup).snapshot(head)), 1)
        with self.assertRaises(ValueError):
            Journal(backup).snapshot(self.journal.snapshot()[-1]["hash"])
        with sqlite3.connect(backup) as db:
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("DELETE FROM journal")
            db.execute("DROP TRIGGER reject_UPDATE")
            db.execute("UPDATE journal SET event = '{}'")
        with self.assertRaises(ValueError):
            Journal(backup).snapshot()

    def test_review_cannot_be_self_approved_or_replace_the_journal(self):
        guidance = self.append("guidance")
        with self.assertRaises(PermissionError):
            self.append("decision", [guidance], Principal(A.name, "reviewer"),
                        disposition="approve", request_id="0" * 32)
        reviewer = Principal("operator", "reviewer")
        transitions = []
        for index, disposition in enumerate(("approve", "revoke", "approve", "revoke"), 1):
            request = {"disposition": disposition, "request_id": str(index) * 32}
            applied = self.append("decision", [guidance], reviewer, **request)
            transitions.append((request, applied))
            self.assertEqual(standing(self.journal.snapshot())[guidance["hash"]], disposition)
            self.assertEqual(self.append("decision", [guidance], reviewer, **request), applied)
        first, applied = transitions[0]
        self.assertEqual(self.append("decision", [guidance], reviewer, **first), applied)
        self.assertEqual(standing(self.journal.snapshot())[guidance["hash"]], "revoke")
        self.assertEqual(len(self.journal.snapshot()), 5)
        with self.assertRaises(ValueError):
            self.append("decision", [guidance], reviewer, disposition="revoke", request_id=first["request_id"])

    def test_correction_requires_distinct_and_comparable_replication(self):
        claim = self.append("hypothesis")
        plan = self.append("protocol", [claim])
        instrument = Principal("circle", "instrument")
        verifier = Principal("review-bench", "verifier")
        ref = digest("study")
        raw = digest("same data")
        obs = self.append("observation", [plan], instrument, ledger=ref, object=raw)
        auditor = Principal(instrument.name, "verifier")
        with self.assertRaises(PermissionError):
            self.append("outcome", [obs], auditor, ledger=ref, object=digest("score"), verdict="refuted")
        first = self.append("outcome", [obs], verifier, ledger=ref, object=digest("score 1"),
                            phase="discovery", verdict="refuted")
        second = self.append("outcome", [obs], verifier, ledger=ref, object=digest("score 2"),
                             phase="replication", verdict="compatible")
        with self.assertRaises(ValueError):
            self.append("correction", [claim, first, second])

    def test_nonfinite_data_and_unknown_schema_are_refused(self):
        with self.assertRaises(ValueError):
            self.append("question", value=float("nan"))
        with self.journal.connection() as db:
            db.execute("PRAGMA user_version = 2")
        with self.assertRaises(ValueError):
            Journal(self.path)

    def test_agent_authentication_and_mcp_read_tools(self):
        token = "f" * 64
        credentials = Credentials({A.name: {"role": A.role, "token_sha256": sha256(token.encode()).hexdigest()}})
        self.assertEqual(credentials.authenticate(token), A)
        with self.assertRaises(PermissionError):
            credentials.authenticate("a" * 64)
        record = self.append("hypothesis")
        reply = mcp_dispatch({"method": "tools/call", "params": {
            "name": "rain_memory_trace", "arguments": {"hash": record["hash"]}}},
            lambda action, args: dispatch(self.journal, A, action, args))
        self.assertEqual(json.loads(reply["content"][0]["text"]), [record])
        with self.assertRaises(KeyError):
            mcp_dispatch({"method": "tools/call", "params": {"name": "append"}}, None)

    def test_controlled_benchmark_recall_is_equal_with_memory(self):
        result = evaluate()
        self.assertEqual(result["cases"], 24)
        for key in ("recall", "retrieval"):
            self.assertEqual(result["scores"]["institutional"][key], result["scores"]["retrieval-only"][key])
        self.assertEqual(result["scores"]["institutional"]["corruption_rejected"]["passed"], 24)


class ContextAdapterTests(unittest.TestCase):
    def test_anna_search_citation_and_verification_contract(self):
        client = Anna("http://127.0.0.1:8000")
        responses = {
            "/api/v1/agent/search": {"status": "success", "results": [{"id": "arxiv:1234"}]},
            "/api/v1/document/arxiv%3A1234/citation": {"id": "arxiv:1234", "text": "Citation"},
            "/api/v1/evidence/verify": {"schema_known": True, "excerpts": []},
        }
        client.request = lambda endpoint, body=None: responses[endpoint]
        lead = client.discover("test query")[0]
        self.assertEqual(lead["standing"], "context")
        self.assertEqual(lead["citation"]["id"], lead["hit"]["id"])
        self.assertEqual(client.verify_record({})["standing"], "context")
        responses["/api/v1/document/arxiv%3A1234/citation"]["id"] = "other"
        with self.assertRaises(ValueError):
            client.discover("test query")

    def test_gbrain_is_source_scoped_and_read_only(self):
        def call(name, args):
            self.assertEqual(name, "search")
            self.assertEqual(args["source_id"], "public-research")
            return {"content": [{"type": "text", "text": "external evidence lead"}]}
        self.assertEqual(gbrain_search(call, "test", "public-research")["standing"], "context")
        with self.assertRaises(ValueError):
            gbrain_search(call, "test", "__all__")
        with self.assertRaises(ValueError):
            loopback("http://127.0.0.1:1234@example.org")


if __name__ == "__main__":
    unittest.main()
