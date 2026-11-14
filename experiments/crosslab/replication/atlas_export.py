"""Import verified simulation evidence into a fresh ATLAS review ledger."""

import argparse
from pathlib import Path
import sys

from run import check_checkout, digest, load, ROOT, verify


def export(atlas, workspace, output):
    protocol = load(ROOT / "protocol.json")
    check_checkout(atlas, protocol["revisions"]["atlas"])
    result = verify(workspace)
    output.mkdir(parents=True, exist_ok=False)
    sys.path.insert(0, str(atlas / "src"))
    from rain_atlas.ledger.store import Ledger
    from rain_atlas.observatory.export import export as export_observatory

    ledger = Ledger(output / "ledger")
    author = {"role": "R.A.I.N.CrossLab", "generation": "scripted"}
    plan = ledger.append("preregistration", {
        "title": "CIRCLE × TRIAD compound-motion replication",
        "question": "Which quality policy survives both pulse generators and fault families?",
        "hypothesis": protocol["hypotheses"]["threshold"],
        "null_hypothesis": "No candidate meets the registered coverage and error limits across strata.",
        "design": protocol,
        "acceptance": {key: protocol[key] for key in
                       ("minimum_coverage", "maximum_accepted_error", "maximum_excess_error")},
        "created_by": author,
    })
    for name, expected in load(workspace / "sha256.json").items():
        path = workspace / name
        ref = ledger.put_file(path)
        if ref != f"sha256:{expected}" or digest(path) != expected:
            raise ValueError("Artifact changed during export")
        ledger.append("dataset", {"experiment": plan.object, "name": name, "origin": "synthetic",
                                  "media_type": "application/json" if path.suffix == ".json" else "text/markdown",
                                  "object": ref, "provenance": {"source_sha256": expected,
                                                                "human_review": "pending"}})
    ledger.append("report", {
        "experiment": plan.object, "findings": [
            {"statement": protocol["hypotheses"][name], "claims": [], "verdict": "unresolved",
             "reason": "Descriptive simulation screen " + ("met." if passed else "missed.")}
            for name, passed in result["explanations_meeting_descriptive_criteria"].items()
        ], "limitations": [
            "Simulation and descriptive thresholds only.",
            "Both generators use CIRCLE timing, IMU traces and beat reconstruction.",
            "Human review pending.",
        ], "reproduction": "Recompute using the pinned protocol and the CIRCLE/TRIAD runner.", "author": author,
        "report_object": ledger.put_file(workspace / "result.json"),
        "acceptance": result["strata"], "conclusion": "Simulation; human review pending.",
    })
    problems = ledger.verify()
    if problems:
        raise ValueError(f"ATLAS ledger verification failed: {problems}")
    export_observatory(output / "ledger", output / "observatory")
    return len(list(ledger.entries()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("atlas", "workspace", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    print(f"ATLAS verified {export(args.atlas.resolve(), args.workspace.resolve(), args.output.resolve())} records.")
