#!/usr/bin/env python3
"""Record the R.A.I.N. Lab's DEMO meeting from a real james_library checkout.

DEMO mode replays one prerecorded meeting. It is recorded here, by running
james_library's own offline engine through the bridge's ``meeting_record`` —
the exact function the live bridge serves — so the fixture is what a LIVE
session would have returned for this question at this R.A.I.N. commit. Like
the other Bethesda importers, it runs the repository's formatter before
hashing, writes a source manifest with the real recording time, and refuses a
checkout whose revision it cannot name.

    python scripts/export-rain-demo.py --library ../james_library

Never hand-edit the fixture or its manifest; re-record instead. The build
(`scripts/validate-bethesda.ts`) fails when they disagree.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import secrets
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
QUESTION = ("What evidence would distinguish coordinated crowd behavior from coincidental "
            "local responses after a Metro closure?")
FIXTURES = REPO / "src" / "bethesda" / "rain" / "fixtures"


def load_bridge():
    spec = importlib.util.spec_from_file_location(
        "rain_bethesda_bridge", REPO / "tools" / "rain-bridge" / "rain_bethesda_bridge.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def write_formatted(path: Path, value: object) -> str:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    subprocess.run([str(REPO / "node_modules" / ".bin" / "prettier"), "--write", str(path)],
                   check=True, capture_output=True)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--library", required=True, help="path to a james_library checkout")
    args = parser.parse_args()
    bridge = load_bridge()
    library = bridge.Library(Path(args.library))
    revision = library.revision()
    if revision["commit"] is None or revision["dirty"] is not False:
        sys.exit("refusing to record: the james_library checkout must be a clean, named commit")
    record = bridge.meeting_record(library, QUESTION, secrets.token_hex(16))
    FIXTURES.mkdir(parents=True, exist_ok=True)
    meeting = FIXTURES / "demo-meeting.json"
    digest = write_formatted(meeting, record)
    manifest = {
        "schema": "rain-bethesda-demo-source/v1",
        "recordedAt": record["produced_at"],
        "recorder": "scripts/export-rain-demo.py (tools/rain-bridge/rain_bethesda_bridge.py meeting_record)",
        "engine": record["engine"],
        "generation": record["generation"],
        "rain": revision,
        "corpus": library.corpus_identity(),
        "question": QUESTION,
        "meetingId": record["meeting_id"],
        "snapshotSha256": digest,
        "license": "james_library is MIT-licensed (Vers3Dynamics). Quotes are verbatim spans of "
                   "its papers/ corpus, kept with their source path, line and character offsets.",
        "notes": [
            "Prerecorded: DEMO replays this one meeting and runs no process.",
            "Scripted: the offline engine's reasoning text is scripted; its evidence is retrieved "
            "and every quote was re-verified with james_library's citation_corpus.verify_quote.",
            "The experiment proposal shipped beside it (demo-proposal.json) was written by hand for "
            "the demo. No model and no R.A.I.N. process produced it.",
        ],
    }
    write_formatted(FIXTURES / "demo-source.json", manifest)
    print(f"recorded {record['meeting_id']} at james_library {revision['commit']} -> {meeting}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
