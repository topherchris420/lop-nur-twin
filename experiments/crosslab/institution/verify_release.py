"""Verify the published snapshot against replay and an independent memory benchmark."""
import json
from pathlib import Path
import sys

from memory import Journal, digest, validate, Principal, ZERO
from view import standing
from study import ORIGINAL, check_checkout, comparable_measurements

ROOT = Path(__file__).resolve().parent


def load(path):
    return json.loads(path.read_text())


def verify(replay, evaluation, atlas):
    check_checkout(atlas, ORIGINAL["atlas_revision"])
    sys.path.insert(0, str(atlas / "src"))
    from rain_atlas.ledger.store import Ledger

    evidence = Ledger(replay / "atlas")
    historic = Ledger(replay / "historical-atlas" / "ledger")
    for ledger in (evidence, historic):
        if ledger.verify():
            raise ValueError("Replay ledger failed ATLAS verification")
    published = load(ROOT.parents[2] / "public/research-memory/snapshot.json")
    expected = load(ROOT / "reference.json")
    fresh = load(replay / "memory.json")
    if expected != published["evaluation"] or expected != fresh["evaluation"]:
        raise ValueError("Published outcome differs from the replay")
    history = {}
    for seq, record in enumerate(published["records"], 1):
        entry = {k: v for k, v in record.items() if k != "hash"}
        if entry["seq"] != seq or entry["prev"] != next(reversed(history), ZERO) or digest(entry) != record["hash"]:
            raise ValueError("Published journal chain changed")
        validate(Principal(entry["actor"], entry["role"]), entry["event"], history)
        history[record["hash"]] = record
    if published["standing"] != standing(list(history.values())):
        raise ValueError("Published review standing changed")
    if published["subjects"] != sorted({r["event"]["subject"] for r in history.values()}):
        raise ValueError("Published subjects changed")

    def semantic(records):
        index = {r["hash"]: r["seq"] for r in records}
        normalized = []
        for row in records:
            item = row["event"]
            omitted = {"ledger", "object"} if item["kind"] in {"observation", "outcome"} else {"ledger"}
            data = {k: v for k, v in item["data"].items() if k not in omitted}
            normalized.append((row["actor"], row["role"], item["kind"], item["subject"],
                               item["text"], [index[r] for r in item["refs"]], data))
        return normalized

    regenerated = Journal(replay / "memory.sqlite").snapshot()
    entries = {entry.hash: entry for entry in evidence.entries()}
    for row in regenerated:
        kind = row["event"]["kind"]
        data = row["event"]["data"]
        if kind == "observation":
            entry = entries["sha256:" + data["ledger"]]
            raw = "sha256:" + data["object"]
            if evidence.get_json(entry.object)["measured_object"] != raw:
                raise ValueError("Replay observation is not bound to the ATLAS report")
            if digest(comparable_measurements(evidence.get_json(raw))) != data["measurement_sha256"]:
                raise ValueError("Replay observation measurements changed")
        if kind == "outcome":
            entry = entries["sha256:" + data["ledger"]]
            if entry.object != "sha256:" + data["object"]:
                raise ValueError("Replay outcome is not bound to the ATLAS report")
            result = evidence.get_json(evidence.get_json(entry.object)["report_object"])
            if result != expected[data["phase"]] or digest(result) != data["score_sha256"]:
                raise ValueError("Replay outcome does not match the independent scorer")
    if semantic(list(history.values())) != semantic(regenerated):
        raise ValueError("Published journal lineage or content-addressed evidence changed")
    if {k: v for k, v in evaluation.items() if k != "resources"} != load(ROOT / "evaluation-reference.json"):
        raise ValueError("Memory evaluation differs from the published scores")
    print("Published lineage, measurement projection, scoring and memory evaluation match the replay.")


if __name__ == "__main__":
    verify(Path(sys.argv[1]), load(Path(sys.argv[2])), Path(sys.argv[3]).resolve())
