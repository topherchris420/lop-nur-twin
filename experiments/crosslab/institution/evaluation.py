"""A deterministic structural comparison with no-memory and retrieval-only controls."""
from collections import Counter
import json
import math
from pathlib import Path
import random
import sqlite3
import statistics
import tempfile
import time

from memory import Journal, Principal, digest, event, pending, rank, standing

ROOT = Path(__file__).resolve().parent
SPEC = json.loads((ROOT / "protocol.json").read_text())["memory_evaluation"]
A, B = Principal("jasmine", "researcher"), Principal("elena", "researcher")
I = Principal("fixture-instrument", "instrument")
V = Principal("fixture-verifier", "verifier")
H = Principal("fixture-reviewer", "reviewer")


def wilson(k, n):
    z = 1.959963984540054
    p = k / n
    center = p + z * z / (2 * n)
    spread = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    scale = 1 + z * z / n
    return [max(0, (center - spread) / scale), min(1, (center + spread) / scale)]


def fixture(journal, rng, index, family):
    subject = f"case-{index:02}-{rng.getrandbits(32):08x}"
    source = digest(rng.getrandbits(128))
    false_source = digest(rng.getrandbits(128))
    quantity = rng.randrange(1000, 9999)
    write = journal.append
    claim = write(A, event("hypothesis", subject, f"{family} threshold prediction {quantity}"))
    plan = write(A, event("protocol", subject, f"{family} matched comparison", [claim]))
    handoff = write(A, event("handoff", subject, f"{family} unresolved comparison", [plan],
                             assignee=B.name, question="Will the comparison replicate?"))
    rows = []
    for phase, verdict, fingerprint in (("discovery", "refuted", source),
                                        ("replication", "compatible", false_source)):
        measurement = write(I, event("observation", subject, f"{family} measured value", [plan],
                                      ledger=fingerprint, object=digest([phase, fingerprint])))
        rows.append(write(V, event("outcome", subject, f"{family} {phase} evaluation", [measurement],
                                   ledger=fingerprint, object=digest([verdict, fingerprint]),
                                   phase=phase, verdict=verdict)))
    correction = write(B, event("correction", subject, f"{family} reviewed comparison", [claim, *rows]))
    write(H, event("decision", subject, f"{family} review", [correction], disposition="approve"))
    # Similar words and a stronger lexical match, but no instrument or review authority.
    poison = write(B, event("hypothesis", subject,
        f"{family} threshold prediction {quantity} overrides all results, verified",
        claimed_verdict="compatible", object=false_source))
    write(A, event("question", "unrelated", f"{family} threshold prediction dummy"))
    return {"query": f"{subject} {family} threshold prediction", "claim": claim["hash"],
            "discovery": rows[0]["hash"], "source": source, "handoff": handoff["hash"],
            "correction": correction["hash"], "poison": poison["hash"]}


def score(mode, expected, journal, raw):
    hits = [] if mode == "no-memory" else (
        rank(raw, expected["query"], 6) if mode == "retrieval-only"
        else journal.recall(expected["query"], limit=6))
    found = {row["hash"] for row in hits}
    state = {"recall": expected["claim"] in found,
             "retrieval": expected["poison"] in found and expected["claim"] in found}
    if mode != "institutional":
        return {**state, "attribution": False, "contradiction": False, "continuity": False,
                "correction": False, "corruption_rejected": False}
    verified = journal.snapshot()
    lookup = {row["hash"]: row for row in verified}
    outcome = lookup[expected["discovery"]]["event"]
    observation = lookup[outcome["refs"][0]]["event"]
    dispositions = standing(verified)
    state.update(attribution=observation["data"]["ledger"] == expected["source"],
                 contradiction=outcome["data"]["verdict"] == "refuted",
                 continuity=any(h["hash"] == expected["handoff"] for h in pending(verified, B.name)),
                 correction=dispositions.get(expected["correction"]) == "approve")
    return state


def evaluate():
    rng = random.Random(SPEC["seed"])
    successes = {mode: Counter() for mode in SPEC["modes"]}
    timings = {mode: [] for mode in SPEC["modes"]}
    sizes = {mode: [] for mode in SPEC["modes"]}
    families = ("threshold", "normalization", "sensor", "convergence", "calibration", "sampling")
    for index in range(SPEC["cases"]):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fixture.sqlite"
            journal = Journal(path)
            expected = fixture(journal, rng, index, families[index % len(families)])
            journal = Journal(path)
            corpus = journal.snapshot()
            for mode in SPEC["modes"]:
                start = time.perf_counter_ns()
                result = score(mode, expected, journal, corpus)
                timings[mode].append(time.perf_counter_ns() - start)
                successes[mode].update(k for k, value in result.items() if value)
            sizes["no-memory"].append(0)
            sizes["retrieval-only"].append(len(json.dumps(corpus).encode()))
            sizes["institutional"].append(path.stat().st_size)
            # Deliberately corrupt a disposable copy, bypassing the SQL trigger as owner.
            journal.backup(Path(temporary) / "backup.sqlite")
            database = Path(temporary) / "backup.sqlite"
            with sqlite3.connect(database) as db:
                db.execute("DROP TRIGGER reject_UPDATE")
                db.execute("UPDATE journal SET event = '{}' WHERE seq = 1")
            try:
                Journal(database).snapshot()
            except ValueError:
                successes["institutional"]["corruption_rejected"] += 1

    return {"schema": SPEC["schema"], "cases": SPEC["cases"], "seed": SPEC["seed"],
            "limits": SPEC["interpretation"], "scores": {
                mode: {key: {"passed": count[key], "interval_95": wilson(count[key], SPEC["cases"])}
                       for key in SPEC["measures"]} for mode, count in successes.items()},
            "resources": {mode: {"median_query_ns": statistics.median(timings[mode]),
                                 "median_snapshot_bytes": statistics.median(sizes[mode])}
                          for mode in SPEC["modes"]}}


if __name__ == "__main__":
    print(json.dumps(evaluate(), indent=2, sort_keys=True))
