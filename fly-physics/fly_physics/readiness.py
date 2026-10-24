"""An initial flat-floor engineering gate, not a biological realism score.

    python -m fly_physics.readiness [--out DIR] [--execution lag-compensated]

Reads sealed results without importing FlyBody, NumPy or MuJoCo. Thresholds
are engineering choices, fixed in this version; never inferred from a run.
Exit 0: this initial gate passes; 1: blocked; 2: invalid inputs/tool failure.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
from pathlib import Path

from . import report, source

SCHEMA = "fly-locomotion-readiness/v1"
# Deliberately independent of scenarios.py, whose replay imports need NumPy.
PLANS = ("walk-1cms", "walk-2cms", "walk-3cms", "turn-on-the-spot", "walk-and-turn")
LIMITS = {
    "ratio_min": 0.8,
    "ratio_max": 1.2,
    "heading_drift_max_deg": 10.0,
    "path_deviation_max_cm": 0.1,
    "stance_slip_max_mm": 0.1,
    "swing_claws_touching_max": 0.1,
    "body_contact_max_s": 0.01,
    "minimum_duration_s": 2.0,
}


def current_identity() -> dict:
    """Use the existing source checker, so stale generated digests cannot pass."""
    checked = subprocess.run(
        ["node", "scripts/run-ts.mjs", "scripts/fly-source.ts", "--check"],
        cwd=source.REPO_ROOT, capture_output=True, text=True, timeout=60,
    )
    if checked.returncode:
        raise ValueError(checked.stderr.strip() or checked.stdout.strip() or "source check failed")
    fly = (source.REPO_ROOT / "src/bethesda/fly/fly.ts").read_text(encoding="utf-8")
    digest = (source.REPO_ROOT / "src/rain/scientific/flySource.ts").read_text(encoding="utf-8")
    version = re.search(r'export const FLY_VERSION = "([^"]+)"', fly)
    sha = re.search(r'\bsha256: "([0-9a-f]{64})"', digest)
    if version is None or sha is None:
        raise ValueError("cannot read the current fly identity")
    return {"fly_version": version[1], "fly_source_sha256": sha[1]}


def _number(value) -> bool:
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def _known_physics(provenance: dict) -> bool:
    """Identical missing metadata are still unknown, not a shared configuration."""
    if not all(isinstance(value, dict) and value for value in provenance.values()):
        return False
    flybody, env, task = (provenance[k] for k in ("flybody", "environment", "task"))
    return (
        bool(re.fullmatch(r"[0-9a-f]{40}", str(flybody.get("commit", ""))))
        and all(isinstance(env.get(k), str) and env[k]
                for k in ("python", "mujoco", "dm_control", "numpy", "scipy", "platform"))
        and task.get("factory") == "flybody.fly_envs.template_task"
        and all(_number(task.get(k)) and task[k] > 0
                for k in ("physics_timestep_s", "control_timestep_s", "mass_g"))
    )


def assess(results: list[dict], identity: dict, execution: str = "lag-compensated") -> dict:
    """Judge every required plan. Missing/unknown metrics block, never pass."""
    checks = []

    def check(name: str, actual, expected, passed: bool) -> None:
        checks.append({"check": name, "actual": actual, "expected": expected, "passed": passed})

    selected = []
    for plan in PLANS:
        run_id = f"{plan}--{execution}"
        matches = [r for r in results if r.get("id") == run_id]
        check(f"{run_id}:present_once", len(matches), 1, len(matches) == 1)
        if len(matches) != 1:
            continue
        r = matches[0]
        selected.append(r)
        p, m, options = r.get("plan", {}), r.get("metrics", {}), r.get("options", {})
        check(f"{run_id}:plan", p.get("id"), plan, p.get("id") == plan)
        actual_identity = {k: p.get(k) for k in identity}
        check(f"{run_id}:current_fly", actual_identity, identity, actual_identity == identity)
        clean = r.get("code", {})
        check(f"{run_id}:clean_commit", clean, "full commit, dirty=false",
              bool(re.fullmatch(r"[0-9a-f]{40}", str(clean.get("commit", ""))))
              and clean.get("dirty") is False)
        flat = (
            r.get("execution") == execution and r.get("perturbation") is None
            and options.get("suspended") is False and options.get("adhesion") == "stance"
            and all(k in options and options[k] is None
                    for k in ("incline", "friction", "push", "step"))
        )
        check(f"{run_id}:flat_floor", options, "unsuspended, unperturbed, stance adhesion", flat)
        duration = m.get("plan_duration_s")
        complete = (
            _number(duration) and duration >= LIMITS["minimum_duration_s"]
            and "terminated_at_s" in m and m["terminated_at_s"] is None
            and all(_number(m.get(k)) and abs(m[k] - duration) <= 0.0021
                    for k in ("simulated_s", "analysed_s"))
        )
        check(f"{run_id}:complete", {k: m.get(k) for k in
              ("plan_duration_s", "simulated_s", "analysed_s", "terminated_at_s")},
              "full plan, at least 2 s, no termination", complete)
        check(f"{run_id}:no_fall", m.get("fell"), False, m.get("fell") is False)
        ratios = ([] if plan == "turn-on-the-spot" else ["speed_ratio", "progress_ratio"])
        if plan in ("turn-on-the-spot", "walk-and-turn"):
            ratios.append("turn_ratio")
        for metric in ratios:
            value = m.get(metric)
            check(f"{run_id}:{metric}", value, [LIMITS["ratio_min"], LIMITS["ratio_max"]],
                  _number(value) and LIMITS["ratio_min"] <= value <= LIMITS["ratio_max"])
        for metric, limit in (
            ("heading_drift_deg", "heading_drift_max_deg"),
            ("path_deviation_max_cm", "path_deviation_max_cm"),
            ("stance_slip_max_mm", "stance_slip_max_mm"),
            ("swing_claws_touching", "swing_claws_touching_max"),
            ("body_contact_s", "body_contact_max_s"),
        ):
            value = m.get(metric)
            low = -LIMITS[limit] if metric == "heading_drift_deg" else 0.0
            check(f"{run_id}:{metric}", value, [low, LIMITS[limit]],
                  _number(value) and low <= value <= LIMITS[limit])
    # Never combine a speed from one controller build with turning from another.
    provenance = [{k: r.get(k) for k in ("code", "flybody", "environment", "task")}
                  for r in selected]
    same = bool(provenance) and all(_known_physics(p) and p == provenance[0] for p in provenance)
    check("one_physics_configuration", provenance[0] if same else provenance,
          "one code commit, FlyBody, environment and task across all plans", same)
    return {
        "schema": SCHEMA, "status": "pass" if all(c["passed"] for c in checks) else "blocked",
        "scope": "initial five-plan flat-floor gate only; not robustness or biological validation",
        "identity": identity, "execution": execution, "limits": dict(LIMITS),
        "results": [{"id": r["id"], "sha256": r.get("sha256")} for r in selected],
        "checks": checks,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path,
                        default=source.REPO_ROOT / "docs/benchmarks/fly-physics")
    parser.add_argument("--execution", choices=("direct", "lag-compensated"),
                        default="lag-compensated")
    args = parser.parse_args(argv)
    try:
        result = assess(report.load_results(args.out), current_identity(), args.execution)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0 if result["status"] == "pass" else 1
    except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError) as exc:
        print(f"readiness: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
