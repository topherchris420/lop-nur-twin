"""Score a model plan against host baselines using an explicit external rubric."""

import argparse
from pathlib import Path

from run import load, put, ROOT


def grade(protocol, attempts, reviews):
    mechanisms = set(protocol["hypotheses"])
    report = {}
    for name, choices in protocol["planning_baselines"].items():
        report[name] = {"mechanisms_named": len(set(choices) & mechanisms),
                        "executable_contrasts": len(set(choices) & mechanisms),
                        "basis": "Fixed historical or factorial design with executable contrasts."}
    for name, model in attempts.items():
        reviewed = reviews[name]
        actual = {p["mechanism"] for p in model["experiments"]}
        executable = set(reviewed["executable_mechanisms"])
        if executable - actual or not reviewed["reason"]:
            raise ValueError("Review must cite only proposed mechanisms and give a reason")
        report[name] = {
            "mechanisms_named": len(actual & mechanisms),
            "executable_contrasts": len(executable & mechanisms),
            "basis": reviewed["reason"], "usage": model["usage"],
        }
    return {"schema": "rain-crosslab-planning-comparison/v1", "task_count": 1,
            "review_origin": "external qualitative assessment", "human_review": "pending", "results": report}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reviews", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("attempts", nargs="+", type=Path)
    args = parser.parse_args()
    put(args.output, grade(load(ROOT / "protocol.json"), {p.stem: load(p) for p in args.attempts},
                           load(args.reviews)))
