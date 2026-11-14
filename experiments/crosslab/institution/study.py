"""Execute the registered correction on CIRCLE and independently score its rows."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "assumptions"))
from challenge import acquire, check_checkout
from verify import check_rows, exact_interval

PROTOCOL = json.loads((ROOT / "protocol.json").read_text())
ORIGINAL = json.loads((ROOT.parent / "assumptions" / "protocol.json").read_text())
PHASES = ("discovery", "replication")


def config():
    return {**ORIGINAL, **{key: PROTOCOL[key] for key in (
        "discovery_seeds", "replication_seeds", "discovery_waveform", "replication_waveform", "profiles"
    )}}


def measure(circle, phase):
    check_checkout(circle, ORIGINAL["circle_revision"])
    sys.path.insert(0, str(circle))
    try:
        return acquire(config(), phase, ["delivery"])
    finally:
        sys.path.remove(str(circle))


def evaluate(rows, phase):
    """Use raw beat times and independent reference arithmetic in the existing independent verifier."""
    check_rows(rows, config(), phase, ["delivery"])
    profiles = PROTOCOL["profiles"]
    threshold, floor = PROTOCOL["error_bpm"], PROTOCOL["coverage_floor"]
    paired = {(r["seed"], r["profile"], r["level"]): r for r in rows}
    cells = {}
    joint = 0
    for seed in PROTOCOL[f"{phase}_seeds"]:
        conditions = []
        for profile in profiles:
            for arm in ("timely", "delayed"):
                row = paired[seed, profile, arm]
                other = paired[seed, profile, "timely"]
                if row["reference_beats"] != other["reference_beats"] or row["mask"]:
                    raise ValueError("Paired arms must retain the same unmasked reference")
                cell = cells.setdefault(f"{profile}/{arm}", {"scheduled": 0, "sufficient_coverage": 0,
                                                            "candidate_errors": 0, "reported": 0,
                                                            "reported_errors": 0})
                cell["scheduled"] += 1
                qualified = row["estimate"] is not None and row["coverage"] >= floor
                cell["sufficient_coverage"] += int(qualified)
                delta = row["estimate"] - row["reference"] if qualified else None
                error = delta is not None and abs(delta) > threshold
                cell["candidate_errors"] += int(error)
                cell["reported"] += int(row["accepted"])
                cell["reported_errors"] += int(row["error"])
                if arm == "delayed" and profile == "rising":
                    matches = delta is not None and delta < -threshold
                elif arm == "delayed" and profile == "falling":
                    matches = delta is not None and delta > threshold
                else:
                    matches = delta is not None and abs(delta) <= threshold
                conditions.append(matches and row["accepted"] == (arm == "timely"))
        joint += all(conditions)
    count = len(PROTOCOL[f"{phase}_seeds"])
    for cell in cells.values():
        cell["reported_error_rate"] = cell["reported_errors"] / cell["reported"] if cell["reported"] else None
    refuted = any(cells[f"{profile}/delayed"]["candidate_errors"] for profile in profiles)
    verdict = ("refuted" if refuted else "inconclusive") if phase == "discovery" else (
        "compatible" if joint / count >= PROTOCOL["minimum_joint_success"] else "inconclusive")
    return {"phase": phase, "verdict": verdict, "joint_seed_successes": joint, "seeds": count,
            "joint_interval_95": exact_interval(joint, count, PROTOCOL["alpha"]), "cells": cells}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("circle", type=Path)
    parser.add_argument("atlas", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    from publish import run

    run(args.circle.resolve(), args.atlas.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
