"""Replay a fixed, simulation-only CIRCLE/TRIAD protocol in a fresh directory."""

import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
import math
from pathlib import Path
import subprocess

from acquisition import acquire, truth_rate


ROOT = Path(__file__).resolve().parent


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def put(path, value):
    with path.open("x", encoding="utf-8") as file:
        json.dump(value, file, indent=2, sort_keys=True, allow_nan=False)
        file.write("\n")


def check_checkout(path, commit):
    def git(*args):
        return subprocess.check_output(["git", "-C", str(path), *args], text=True, timeout=30).strip()

    if (Path(git("rev-parse", "--show-toplevel")).resolve() != path
            or git("rev-parse", "HEAD") != commit or git("status", "--porcelain")):
        raise ValueError(f"{path.name} must be a clean checkout at {commit}")


def error(estimate, row, protocol):
    return abs(estimate - row["truth_bpm"]) > protocol["error_bpm"]


def accepted(row, name, threshold):
    if row["estimate_bpm"] is None:
        return False
    score = row["beat_coverage"]
    if name == "original":
        return round(1 - score, 6) <= threshold
    if name == "coverage_075":
        return score >= 0.75
    if name == "fresh_coverage_065":
        return row["fresh_ppg"] and score >= 0.65
    if name == "accept_available":
        return True
    raise ValueError(f"Unknown registered policy {name}")


def counts(rows, policy, threshold, protocol):
    selected = [r for r in rows if accepted(r, policy, threshold)]
    errors = sum(error(r["estimate_bpm"], r, protocol) for r in selected)
    return {"scheduled": len(rows), "accepted": len(selected), "errors": errors,
            "coverage": len(selected) / len(rows), "risk": errors / len(selected) if selected else None}


def triad_input(name, rows, protocol):
    observed = Counter((r["split"], r["scenario"], r["sequence"]) for r in rows)
    expected = {(split, family, f"seed-{seed}"): protocol["windows_per_session"]
                for split, families, seeds in (
                    ("calibration", ["clean"], protocol["calibration_seeds"]),
                    ("test", protocol["test_families"], protocol["test_seeds"]),
                ) for family in families for seed in seeds}
    if observed != expected or len({r["id"] for r in rows}) != len(rows):
        raise ValueError("Scheduled windows differ from registration")
    if any(r["truth_bpm"] != truth_rate(r["truth_beat_seconds"]) or not 0 <= r["beat_coverage"] <= 1 for r in rows):
        raise ValueError("Invalid reference beats or quality score")
    return {
        "schema_version": "triad-metrology-1", "model_id": name, "experiment_id": "crosslab-compound-motion-v1",
        "loss": "euclidean", "tolerance": protocol["error_bpm"], "target_coverage": protocol["calibration_target"],
        "calibration_scenario": "clean", "bootstrap_replicates": 500, "bootstrap_seed": 17, "reliability_bins": 5,
        "evidence": {"numerical_required": False, "checks": {}, "evidence_resources": [],
                     "evaluated_scenarios": protocol["test_families"], "prospective_power_supported": False,
                     "independent_replication": False},
        "records": [{**{key: r[key] for key in ("id", "split", "scenario", "sequence")},
                     "prediction": [r["estimate_bpm"]], "truth": [r["truth_bpm"]],
                     "uncertainty": round(1 - r["beat_coverage"], 6), "error_probability": None,
                     "spatial_cluster": None} for r in rows if r["estimate_bpm"] is not None],
    }


def evaluate(workspace, protocol, rows, binary=None, source_hash=None, lock_hash=None):
    report = {}
    for name in protocol["generators"]:
        data = rows[name]
        source = triad_input(name, data, protocol)
        infile, outfile = (workspace / f"{name}-{suffix}.json" for suffix in ("input", "triad"))
        if binary:
            put(infile, source)
            subprocess.run([binary, "metrology", "evaluate", "--input", infile, "--output", outfile],
                           check=True, timeout=120)
            subprocess.run([binary, "metrology", "validate", "--input", outfile], check=True, timeout=120)
        envelope = load(outfile)
        triad = envelope["report"]
        if (load(infile) != source or triad["input"] != source
                or envelope["execution"]["input_bytes_sha256"] != digest(infile)
                or triad["evaluator_source_sha256"] != source_hash or triad["dependency_lock_sha256"] != lock_hash):
            raise ValueError("TRIAD source, input or lock digest mismatch")
        scores = sorted(r["uncertainty"] for r in source["records"] if r["split"] == "calibration")
        threshold = scores[math.ceil(len(scores) * protocol["calibration_target"]) - 1]
        if triad["threshold"] != threshold:
            raise ValueError("TRIAD threshold did not reproduce")
        strata = {}
        for family in protocol["test_families"]:
            test = [r for r in data if r["scenario"] == family and r["split"] == "test"]
            policies = {policy: counts(test, policy, threshold, protocol) for policy in protocol["policies"]}
            base = policies["original"]
            native = triad["scenarios"][family]["operational"]
            if (base["accepted"], base["errors"], base["risk"]) != (
                native["accepted"], native["accepted_errors"], native["selective_error_risk"]
            ):
                raise ValueError("TRIAD acceptance or error arithmetic did not reproduce")
            for policy in policies.values():
                risk = policy["risk"]
                policy["passes_screen"] = (
                    policy["coverage"] >= protocol["minimum_coverage"] and risk is not None
                    and base["risk"] is not None and risk <= protocol["maximum_accepted_error"]
                    and risk - base["risk"] <= protocol["maximum_excess_error"]
                )
            common = [r for r in test if r["estimate_bpm"] is not None and r["unmasked_estimate_bpm"] is not None]
            difference = (sum(error(r["unmasked_estimate_bpm"], r, protocol)
                              - error(r["estimate_bpm"], r, protocol) for r in common) / len(common) if common else None)
            strata[family] = {"policies": policies, "estimates_available": policies["accept_available"]["accepted"],
                              "paired_reconstruction_count": len(common), "paired_reconstruction_error_change": difference}
        report[name] = strata
    surviving_policies = [p for p in protocol["policies"] if p not in ("original", "accept_available") and all(
        stratum["policies"][p]["passes_screen"] for strata in report.values() for stratum in strata.values()
    )]
    floor = protocol["mechanism_effect_floor"]
    explanation = {
        "threshold": bool(surviving_policies),
        "reconstruction": any(s["paired_reconstruction_count"] >= protocol["minimum_paired_estimates"]
                              and abs(s["paired_reconstruction_error_change"]) >= floor
                              for strata in report.values() for s in strata.values()),
        "compound_fault": any(abs(strata["motion_heavy"]["estimates_available"]
                                  - strata["motion_contact_loss"]["estimates_available"])
                              / (len(protocol["test_seeds"]) * protocol["windows_per_session"]) >= floor
                              for strata in report.values()),
    }
    return {"schema": "rain-crosslab-result/v1", "evidence_class": "simulated", "human_review": "pending",
            "strata": report, "surviving_policies": surviving_policies,
            "explanations_meeting_descriptive_criteria": explanation}


def hashes(workspace):
    return {p.name: digest(p) for p in sorted(workspace.iterdir()) if p.is_file() and p.name != "sha256.json"}


def verify(workspace):
    protocol = load(ROOT / "protocol.json")
    registration = load(workspace / "registration.json")
    if (load(workspace / "sha256.json") != hashes(workspace)
            or registration["protocol"] != protocol
            or registration["protocol_sha256"] != digest(ROOT / "protocol.json")):
        raise ValueError("Registered protocol or evidence digest mismatch")
    result = evaluate(workspace, protocol, load(workspace / "windows.json"),
                      source_hash=registration["triad_source_sha256"], lock_hash=registration["triad_lock_sha256"])
    if load(workspace / "result.json") != result:
        raise ValueError("Stored result differs from independently recomputed measurements")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--circle", type=Path)
    parser.add_argument("--triad", type=Path)
    parser.add_argument("--target", type=Path)
    parser.add_argument("--cargo", default="cargo")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    if args.verify:
        verify(workspace)
        return
    if not (args.circle and args.triad and args.target):
        parser.error("A run requires --circle, --triad and --target")
    circle, triad, target = [p.resolve() for p in (args.circle, args.triad, args.target)]
    protocol = load(ROOT / "protocol.json")
    for path, name in ((circle, "circle"), (triad, "triad")):
        check_checkout(path, protocol["revisions"][name])
    workspace.mkdir(parents=True, exist_ok=False)
    registration = {"registered_at": datetime.now(timezone.utc).isoformat(),
                    "protocol": protocol, "protocol_sha256": digest(ROOT / "protocol.json"),
                    "triad_source_sha256": digest(triad / "src/metrology.rs"),
                    "triad_lock_sha256": digest(triad / "Cargo.lock")}
    put(workspace / "registration.json", registration)
    subprocess.run([args.cargo, "build", "--locked", "--manifest-path", triad / "Cargo.toml", "--target-dir",
                    target, "--bin", "triad"], check=True, timeout=1200)
    rows = acquire(circle, protocol)
    put(workspace / "windows.json", rows)
    result = evaluate(workspace, protocol, rows, target / "debug/triad",
                      registration["triad_source_sha256"], registration["triad_lock_sha256"])
    put(workspace / "result.json", result)
    put(workspace / "sha256.json", hashes(workspace))
    verify(workspace)


if __name__ == "__main__":
    main()
