"""Verify the published snapshot against replay and an independent memory benchmark."""
import json
from pathlib import Path
import sys

from memory import Journal, digest, validate, Principal, ZERO
from view import standing

ROOT = Path(__file__).resolve().parent


def load(path):
    return json.loads(path.read_text())


def verify(replay, evaluation):
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
            data = {k: v for k, v in item["data"].items() if k != "ledger"}
            normalized.append((row["actor"], row["role"], item["kind"], item["subject"],
                               item["text"], [index[r] for r in item["refs"]], data))
        return normalized

    if semantic(list(history.values())) != semantic(Journal(replay / "memory.sqlite").snapshot()):
        raise ValueError("Published journal lineage or content-addressed evidence changed")
    if {k: v for k, v in evaluation.items() if k != "resources"} != load(ROOT / "evaluation-reference.json"):
        raise ValueError("Memory evaluation differs from the published scores")
    print("Published lineage, object digests, scoring and memory evaluation match the replay.")


if __name__ == "__main__":
    verify(Path(sys.argv[1]), load(Path(sys.argv[2])))
