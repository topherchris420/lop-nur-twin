"""Coverage and absolute error boundaries cannot be traded between strata."""

import unittest

from grade_plan import grade
from run import counts


class ReplicationTests(unittest.TestCase):
    def test_missing_estimates_remain_in_coverage_denominator(self):
        row = {"estimate_bpm": 63, "beat_coverage": 0.8, "fresh_ppg": True, "truth_bpm": 60}
        rows = [row, {**row, "estimate_bpm": None}, {**row, "estimate_bpm": 64}]
        self.assertEqual(counts(rows, "coverage_075", 0.1, {"error_bpm": 3}),
                         {"scheduled": 3, "accepted": 2, "errors": 1, "coverage": 2/3, "risk": 0.5})

    def test_freshness_requirement_does_not_fabricate_estimates(self):
        row = {"estimate_bpm": 60, "beat_coverage": 0.7, "fresh_ppg": False, "truth_bpm": 60}
        self.assertIsNone(counts([row], "fresh_coverage_065", 0.1, {"error_bpm": 3})["risk"])

    def test_mechanism_names_do_not_earn_executable_plan_credit(self):
        protocol = {"hypotheses": {"threshold": ""}, "planning_baselines": {"fixed": ["threshold"]}}
        plans = {"model": {"experiments": [{"mechanism": "threshold"}], "usage": {}}}
        reviews = {"model": {"executable_mechanisms": [], "reason": "No measurable falsifier."}}
        score = grade(protocol, plans, reviews)["results"]["model"]
        self.assertEqual((score["mechanisms_named"], score["executable_contrasts"]), (1, 0))
