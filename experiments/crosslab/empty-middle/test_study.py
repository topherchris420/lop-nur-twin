import json
import math
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import model  # noqa: E402
import study  # noqa: E402


def reference_three_level(area, steps=20000, reverse=False):
    """Plain RK4 on A, mode, B in scaled time: an independent integrator."""
    dt = 1.0 / steps
    psi = np.array([1.0, 0.0, 0.0], dtype=np.complex128)
    peak = 0.0

    def rhs(tau, state):
        a, b = model.pulses(np.array(tau), area, reverse)
        Hm = np.array([[0, a, 0], [a, 0, b], [0, b, 0]], dtype=np.float64)
        return -1j * Hm @ state

    for n in range(steps):
        tau = n * dt
        k1 = rhs(tau, psi)
        k2 = rhs(tau + dt / 2, psi + dt / 2 * k1)
        k3 = rhs(tau + dt / 2, psi + dt / 2 * k2)
        k4 = rhs(tau + dt, psi + dt * k3)
        psi = psi + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        peak = max(peak, abs(psi[1]) ** 2)
    return abs(psi[2]) ** 2, peak


class GridTest(unittest.TestCase):
    def setUp(self):
        self.protocol = study.load_protocol()

    def test_search_space_matches_registration(self):
        settings = study.settings(self.protocol)
        self.assertEqual(len(settings), self.protocol["search"]["settings_per_cell"])
        freqs = sorted({f for f, _ in settings})
        self.assertEqual(len(freqs), 73)
        self.assertAlmostEqual(freqs[0], 1e-5)
        self.assertAlmostEqual(freqs[-1], 1e4, places=6)

    def test_distances_run_from_one_micron_to_one_millimetre(self):
        grid = study.distances(self.protocol)
        self.assertEqual(len(grid), 25)
        self.assertAlmostEqual(grid[0], 1e-6)
        self.assertAlmostEqual(grid[-1], 1e-3)

    def test_draws_are_paired_across_lattice_sizes(self):
        z1, w1 = study.draws(25101, 50)
        z2, w2 = study.draws(25101, 90)
        np.testing.assert_array_equal(z1, z2)
        np.testing.assert_array_equal(w1, w2[:50])


class SealTest(unittest.TestCase):
    def test_draft_protocol_keeps_heldout_sealed(self):
        with self.assertRaises(PermissionError):
            study.heldout_seeds()

    def test_seal_opens_only_for_a_matching_freeze_record(self):
        # A stand-in protocol with its own salt, so no registered held-out seed
        # is ever computed before the held-out run.
        protocol = study.load_protocol()
        protocol["status"] = "frozen"
        protocol["seeds"]["heldout"]["salt"] = "unit-test-salt"
        protocol["seeds"]["heldout"]["count"] = 3
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "protocol.json"
            path.write_text(json.dumps(protocol))
            freeze = Path(work) / "freeze.json"
            with self.assertRaises(PermissionError):
                study.heldout_seeds(path)
            freeze.write_text(json.dumps({"protocol_sha256": "0" * 64}))
            with self.assertRaises(PermissionError):
                study.heldout_seeds(path)
            freeze.write_text(json.dumps({"protocol_sha256": study.protocol_hash(path)}))
            seeds = study.heldout_seeds(path)
        self.assertEqual(len(seeds), 3)
        self.assertNotIn(seeds[0], study.load_protocol()["seeds"]["dev"])


class SolverTest(unittest.TestCase):
    def test_three_level_matches_independent_integrator(self):
        spec = model.single_mode()
        for area, reverse in ((40.0, False), (160.0, False), (40.0, True)):
            part = model.partition(spec, area, 100)
            run = model.propagate([part], np.zeros((1, 2)), [area], [1.0], 20000, reverse=reverse)
            arrival, peak = reference_three_level(area, reverse=reverse)
            self.assertAlmostEqual(run.arrival[0], arrival, delta=1e-6)
            self.assertAlmostEqual(run.middle[0].max(), peak, delta=2e-3)
            self.assertLess(run.norm_error[0], 1e-10)

    def test_counterintuitive_order_keeps_the_middle_empty(self):
        spec = model.single_mode()
        part = model.partition(spec, 640.0, 100)
        forward = model.propagate([part], np.zeros((1, 2)), [640.0], [1.0], 8000)
        backward = model.propagate([part], np.zeros((1, 2)), [640.0], [1.0], 8000, reverse=True)
        self.assertGreater(forward.arrival[0], 0.999)
        self.assertLess(forward.middle[0].max(), 1e-3)
        self.assertGreater(backward.middle[0].max(), 0.5)

    def test_far_mode_elimination_agrees_with_a_wider_explicit_window(self):
        spec = model.free_guide_lowest(1e-6)
        omega = 2 * math.pi * 30.0
        duration = 160.0 / omega
        values = []
        for window in (100, 400):
            part = model.partition(spec, omega, window)
            steps = model.required_steps(part, np.zeros(2), duration)
            run = model.propagate([part], np.zeros((1, 2)), [omega], [duration], steps)
            values.append((run.arrival[0], run.middle[0].max()))
        self.assertLess(abs(values[0][0] - values[1][0]), 1e-4)
        self.assertLess(abs(values[0][1] - values[1][1]), 1e-4)


class SpectrumTest(unittest.TestCase):
    def test_guide_scales_as_registered(self):
        self.assertAlmostEqual(model.guide_ground(1e-6) / (2 * math.pi), 1248, delta=1)
        spec = model.free_guide_lowest(1e-6)
        self.assertEqual(spec.resonant, 0)
        self.assertAlmostEqual(spec.energies[1], 3 * model.guide_ground(2e-6), delta=1e-6)

    def test_fast_mode_is_nearest_the_kinetic_energy(self):
        length = 11e-6
        kinetic = 2 * math.pi * 10000
        n = model.fast_mode_number(length, kinetic)
        ground = model.guide_ground(length)
        for other in (n - 1, n + 1):
            self.assertLessEqual(abs(ground * n * n - kinetic), abs(ground * other * other - kinetic))

    def test_lattice_has_an_odd_chain_with_a_zero_mode(self):
        for d in (1e-6, 10e-6, 1e-4):
            sites = model.lattice_sites(d)
            self.assertEqual(sites % 2, 1)
            self.assertGreaterEqual((sites - 1) * model.LATTICE_SPACING, d * (1 - 1e-9))
            spec = model.lattice(d, 2 * math.pi * 300)
            self.assertEqual(spec.energies[spec.resonant], 0.0)
            self.assertAlmostEqual(abs(spec.rB[spec.resonant]), 1.0)

    def test_clean_and_disordered_lattice_agree_without_disorder(self):
        clean = model.lattice(10e-6, 1.0)
        dense = model.lattice(10e-6, 1.0, np.zeros(model.lattice_sites(10e-6)))
        np.testing.assert_allclose(np.sort(clean.energies), np.sort(dense.energies), atol=1e-12)


class RuleTest(unittest.TestCase):
    def setUp(self):
        self.protocol = study.load_protocol()

    def test_cell_verdicts(self):
        rule = lambda F, M: study.cell_verdict({"F": F, "M": M}, self.protocol)  # noqa: E731
        self.assertEqual(rule([0.91, 0.95], [0.002, 0.009]), "PASS")
        self.assertEqual(rule([0.80, 0.89], [0.002, 0.009]), "FAIL")
        self.assertEqual(rule([0.91, 0.95], [0.010, 0.02]), "FAIL")
        self.assertEqual(rule([0.88, 0.92], [0.002, 0.009]), "INCONCLUSIVE")
        self.assertEqual(rule([0.91, 0.95], [0.008, 0.011]), "INCONCLUSIVE")
        self.assertEqual(study.cell_verdict(None, self.protocol, all_capped=True), "FAIL")

    def test_limits_and_h1(self):
        grid = [1, 2, 3, 4]
        self.assertEqual(study.limits(["PASS", "PASS", "INCONCLUSIVE", "FAIL"], grid), (2, 4))
        self.assertEqual(study.limits(["FAIL", "PASS", "PASS", "PASS"], grid), (None, 1))
        open_at_scale = {"G1": ["PASS"] * 4, "G2": ["FAIL"] * 4}
        self.assertEqual(study.h1_verdict(open_at_scale, True, True, True, 4, grid), "OPEN AT SCALE")
        micro = {"G1": ["PASS", "FAIL", "FAIL", "FAIL"], "G2": ["FAIL"] * 4}
        self.assertEqual(study.h1_verdict(micro, True, True, True, 4, grid), "MICROSCALE ONLY")
        self.assertEqual(study.h1_verdict(micro, True, False, True, 4, grid), "INCONCLUSIVE")
        self.assertEqual(study.h1_verdict(micro, False, True, True, 4, grid), "INVALID")
        self.assertEqual(study.h1_verdict(micro, True, True, False, 4, grid), "INCOMPLETE")

    def test_h2_and_h3(self):
        grid = {i: 10.0 ** (i / 8) for i in range(8, 25)}
        treq = {i: 3.0 * d**2 for i, d in grid.items()}
        self.assertEqual(study.h2_verdict(treq, grid, 2, 0.2)[0], "CONFIRMED")
        self.assertEqual(study.h2_verdict(treq, grid, 1, 0.2)[0], "NOT CONFIRMED")
        treq[12] = None
        self.assertEqual(study.h2_verdict(treq, grid, 2, 0.2)[0], "INCONCLUSIVE")
        self.assertEqual(study.h3_verdict({i: 1.0 for i in grid}, list(grid)), "CONTRADICTED")
        self.assertEqual(study.h3_verdict({}, list(grid)), "UPHELD")
        self.assertEqual(study.h3_verdict({8: 1.0}, list(grid)), "INCONCLUSIVE")

    def test_bootstrap_is_reproducible_and_brackets_the_mean(self):
        rng = np.random.default_rng(1)
        arrival = 0.9 + 0.05 * rng.random(8)
        middle = 0.01 * rng.random((8, 11))
        one = study.bootstrap(arrival, middle, 1.0, self.protocol)
        two = study.bootstrap(arrival, middle, 1.0, self.protocol)
        self.assertEqual(one, two)
        self.assertLessEqual(one["F"][0], arrival.mean())
        self.assertGreaterEqual(one["F"][1], arrival.mean())

    def test_loss_cap_skips_long_settings(self):
        conditions = study.budget(self.protocol, "reference")
        entries = study.run_settings(self.protocol, "G0", 1e-6, conditions, [(1e-3, 10.0)], [25101])
        self.assertEqual(entries[0]["skipped"], "loss cap")


if __name__ == "__main__":
    unittest.main()
