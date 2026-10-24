"""Failure cases that must not promote a fly to the next development stage.

Also runnable without the physics environment:
PYTHONPATH=fly-physics python -m unittest discover -s fly-physics/tests -p test_readiness.py
"""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fly_physics import report
from fly_physics.readiness import PLANS, assess, main

IDENTITY = {"fly_version": "test/1", "fly_source_sha256": "a" * 64}


def ideal_results():
    """Synthetic perfect tracking, not a claim about the actual controller."""
    return [report.sealed({
        "schema": "fly-physics-result/v1", "id": f"{plan}--lag-compensated",
        "execution": "lag-compensated", "perturbation": None,
        "plan": {"id": plan, **IDENTITY},
        "code": {"commit": "b" * 40, "dirty": False},
        "flybody": {"commit": "c" * 40},
        "environment": {k: "test" for k in
                        ("python", "mujoco", "dm_control", "numpy", "scipy", "platform")},
        "task": {"factory": "flybody.fly_envs.template_task", "physics_timestep_s": 0.0002,
                 "control_timestep_s": 0.002, "mass_g": 0.001},
        "options": {"suspended": False, "adhesion": "stance", "incline": None,
                    "friction": None, "push": None, "step": None},
        "metrics": {"plan_duration_s": 2.0, "simulated_s": 2.0, "analysed_s": 2.0,
                    "terminated_at_s": None, "fell": False, "speed_ratio": 1.0,
                    "progress_ratio": 1.0, "turn_ratio": 1.0, "heading_drift_deg": 0.0,
                    "path_deviation_max_cm": 0.0, "stance_slip_max_mm": 0.0,
                    "swing_claws_touching": 0.0, "body_contact_s": 0.0},
    }) for plan in PLANS]


class ReadinessTests(unittest.TestCase):
    def test_complete_ideal_matrix_passes_and_is_deterministic(self):
        results = ideal_results()
        before = copy.deepcopy(results)
        assessment = assess(results, IDENTITY)
        self.assertEqual(assessment["status"], "pass")
        self.assertEqual(assessment, assess(results, IDENTITY))
        self.assertEqual(results, before)

    def test_speed_without_forward_progress_and_wrong_way_turning_block(self):
        results = ideal_results()
        results[0]["metrics"].update(speed_ratio=1.0, progress_ratio=-1.0)
        results[-1]["metrics"]["turn_ratio"] = -1.0
        failed = [c["check"] for c in assess(results, IDENTITY)["checks"] if not c["passed"]]
        self.assertTrue(any(c.endswith(":progress_ratio") for c in failed))
        self.assertTrue(any(c.endswith(":turn_ratio") for c in failed))

    def test_unknown_nonfinite_boolean_metrics_and_truncated_runs_block(self):
        changes = [
            {"speed_ratio": None}, {"speed_ratio": float("nan")},
            {"speed_ratio": float("inf")}, {"speed_ratio": True},
            {"speed_ratio": 10 ** 1000},
            {"simulated_s": 1.0}, {"analysed_s": 1.0}, {"plan_duration_s": 0.1},
            {"terminated_at_s": 1.0}, {"fell": True}, {"fell": None},
            {"body_contact_s": 0.5}, {"swing_claws_touching": 0.8},
        ]
        for change in changes:
            with self.subTest(change=change):
                results = ideal_results()
                results[0]["metrics"].update(change)
                self.assertEqual(assess(results, IDENTITY)["status"], "blocked")

    def test_missing_duplicate_stale_dirty_or_mixed_results_block(self):
        variants = [[], ideal_results()[:-1], ideal_results() + [ideal_results()[0]]]
        for section, key, value in (
            ("plan", "fly_version", "old"), ("plan", "fly_source_sha256", "0" * 64),
            ("code", "dirty", True), ("code", "commit", "d" * 40),
            ("environment", "mujoco", "other"), ("options", "suspended", True),
            ("options", "incline", {"deg": 30}),
        ):
            results = ideal_results()
            results[0][section][key] = value
            variants.append(results)
        for results in variants:
            self.assertEqual(assess(results, IDENTITY)["status"], "blocked")

    def test_absent_required_fields_block(self):
        for section, key in (("metrics", "terminated_at_s"), ("metrics", "progress_ratio"),
                             ("options", "incline"), ("code", "dirty")):
            results = ideal_results()
            del results[0][section][key]
            self.assertEqual(assess(results, IDENTITY)["status"], "blocked")

    def test_shared_but_unknown_physics_does_not_pass(self):
        results = ideal_results()
        for result in results:
            result["environment"] = {}
        self.assertEqual(assess(results, IDENTITY)["status"], "blocked")

    def test_cli_checks_seals_and_distinguishes_invalid_from_blocked(self):
        with tempfile.TemporaryDirectory() as directory, patch(
            "fly_physics.readiness.current_identity", return_value=IDENTITY
        ), patch("builtins.print"):
            path = Path(directory)
            self.assertEqual(main(["--out", directory]), 1)
            for r in ideal_results():
                report.write(path, r)
            self.assertEqual(main(["--out", directory]), 0)
            result_path = path / f"{PLANS[0]}--lag-compensated.json"
            data = json.loads(result_path.read_text())
            data["metrics"]["speed_ratio"] = 0.5
            result_path.write_text(json.dumps(data))
            self.assertEqual(main(["--out", directory]), 2)


if __name__ == "__main__":
    unittest.main()
