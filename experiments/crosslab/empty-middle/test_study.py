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


def synthetic_search(work, protocol, verdict_of=lambda k: "PASS" if k <= 3 else "FAIL", selected=True):
    """A complete development search written from rules, not simulation."""
    digest = study.design_hash(protocol)
    grid = study.distances(protocol)
    ok = {"evaluable": True, "F": 0.0, "M": 0.0}

    def cell(design, k, budget, verdict):
        interval = {"F": [0.95, 0.97], "M": [0.001, 0.002]} if verdict == "PASS" else {"F": [0.1, 0.2], "M": [0.2, 0.3]}
        return {
            "design": design, "distance_index": k, "distance_um": grid[k] / model.MICRON, "budget": budget,
            "dev_verdict": verdict, "selected": {"F": 0.5, "M": 0.1} if selected else None, "dev_interval": interval,
            "V2_window": ok, "V8_steps": ok, "V4_reversed": {"fail_on_M": True}, "max_norm_error": 1e-12,
            "design_sha256": digest, "seed_list": study.dev_seeds(protocol), "cpu_s": 1.0,
        }

    for design in study.DESIGNS:
        for k in range(len(grid)):
            for budget in study.BUDGETS:
                study.put(work / "cells" / f"{study.cell_label(design, k, budget)}.json", cell(design, k, budget, verdict_of(k)))
        for k in study.fit_indices(protocol):
            power = protocol["predicted_slopes"][design]
            treq = None if design == "G3" else 2.0 * (grid[k] / 1e-6) ** power
            study.put(work / "noiseless" / f"{design}-d{k:02d}.json",
                      {"design": design, "distance_index": k, "T_req_s": treq, "design_sha256": digest, "max_norm_error": 0.0})
    study.put(work / "control-G0.json", cell("G0", 0, "reference", "PASS"))


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



class HashTest(unittest.TestCase):
    def test_design_hash_ignores_only_status_and_registration(self):
        protocol = study.load_protocol()
        base = study.design_hash(protocol)
        frozen = dict(protocol, status="frozen", registered="2026-12-01")
        self.assertEqual(study.design_hash(frozen), base)
        changed = json.loads(json.dumps(protocol))
        changed["thresholds"]["arrival_min"] = 0.91
        self.assertNotEqual(study.design_hash(changed), base)


class NumericsRuleTest(unittest.TestCase):
    def setUp(self):
        self.protocol = study.load_protocol()

    def test_small_changes_pass_and_large_ones_pass_only_far_from_a_threshold(self):
        near = {"dev_interval": {"F": [0.905, 0.93], "M": [0.004, 0.0095]}}
        far = {"dev_interval": {"F": [0.002, 0.004], "M": [0.24, 0.26]}}
        small = {"evaluable": True, "F": 5e-5, "M": 5e-5}
        large = {"evaluable": True, "F": 5e-4, "M": 1.3e-4}
        self.assertTrue(study.numerics_ok(small, near, self.protocol))
        self.assertFalse(study.numerics_ok(large, near, self.protocol))
        self.assertTrue(study.numerics_ok(large, far, self.protocol))
        self.assertFalse(study.numerics_ok({"evaluable": False}, far, self.protocol))

    def test_a_fail_needs_only_one_criterion_it_fails_held(self):
        # The two G1 cells of the first full dev search, generous budget.
        window = {"dev_interval": {"F": [0.000116, 0.000303], "M": [0.0860, 0.0959]}}
        steps = {"dev_interval": {"F": [0.8858, 0.8982], "M": [0.0541, 0.0965]}}
        self.assertTrue(study.numerics_ok({"evaluable": True, "F": 3.9e-4, "M": 0.0129}, window, self.protocol))
        self.assertTrue(study.numerics_ok({"evaluable": True, "F": 1.82e-4, "M": 5.1e-4}, steps, self.protocol))
        # Neither failing criterion held: the check fails.
        self.assertFalse(study.numerics_ok({"evaluable": True, "F": 0.1, "M": 0.0129}, window, self.protocol))
        # A FAIL on M alone, with F straddling its threshold: holding F is not enough.
        on_M = {"dev_interval": {"F": [0.85, 0.95], "M": [0.02, 0.03]}}
        self.assertFalse(study.numerics_ok({"evaluable": True, "F": 5e-5, "M": 0.005}, on_M, self.protocol))
        self.assertTrue(study.numerics_ok({"evaluable": True, "F": 0.02, "M": 5e-4}, on_M, self.protocol))
        # INCONCLUSIVE still needs both held.
        unsure = {"dev_interval": {"F": [0.88, 0.95], "M": [0.002, 0.008]}}
        self.assertFalse(study.numerics_ok({"evaluable": True, "F": 5e-5, "M": 5e-4}, unsure, self.protocol))

    def test_window_scales_with_each_modes_coupling(self):
        spec = model.free_guide_lowest(1e-3)
        omega = 10 * model.guide_ground(1e-3 + model.GUIDE_MARGIN)
        part = model.partition(spec, omega, 100)
        plain = np.abs(spec.energies) <= 100 * omega
        self.assertGreater(part.energies.size, int(plain.sum()))
        far = np.ones(spec.energies.size, dtype=bool)
        far[np.isin(spec.energies, part.energies)] = False
        ratio = omega * np.maximum(np.abs(spec.rA[far]), np.abs(spec.rB[far])) / np.abs(spec.energies[far])
        self.assertLess(float(ratio.max()), 0.1 + 1e-12)


class EliminationCapTest(unittest.TestCase):
    def test_runs_whose_eliminated_population_rivals_the_traps_are_skipped(self):
        protocol = study.load_protocol()
        grid = study.distances(protocol)
        generous = study.budget(protocol, "generous")
        seeds = study.dev_seeds(protocol)[:2]
        cap = protocol["model"]["elimination_cap"]
        setting = [(10 ** (13 / 8), 10.0)]
        # G1 at 100 um, generous: the setting an automated review found reporting M = 1.29.
        far = study.run_settings(protocol, "G1", grid[16], generous, setting, seeds)[0]
        self.assertEqual(far["skipped"], "elimination cap")
        self.assertGreater(far["eliminated_ratio"], cap)
        self.assertNotIn("M", far)
        near = study.run_settings(protocol, "G1", grid[8], generous, setting, seeds)[0]
        self.assertNotIn("skipped", near)
        self.assertLessEqual(near["eliminated_ratio"], cap)
        self.assertLessEqual(near["M"], 1.0)


class RecordTest(unittest.TestCase):
    def test_records_round_trip_with_flat_lists_on_one_line(self):
        value = {"b": [1, 2.5, None, "run"], "a": {"x": [[1, 2], [3]], "y": 1e-7}}
        text = study._dumps(value)
        self.assertEqual(json.loads(text), value)
        self.assertIn('"b": [1, 2.5, null, "run"]', text)

    def test_noiseless_search_returns_the_first_pass_in_order_of_T(self):
        protocol = study.load_protocol()
        found, tried, how = study.noiseless_treq(protocol, "G0", 1e-6, batch=16)
        self.assertEqual(how, "found")
        times = [e["duration_s"] for e in tried]
        self.assertEqual(times, sorted(times))
        self.assertIs(tried[-1], found)
        for entry in tried[:-1]:
            self.assertFalse(entry["arrival"][0] >= 0.9 and entry["M"] < 0.01)
        alone = study.noiseless_treq(protocol, "G0", 1e-6, batch=1)[0]
        self.assertEqual(alone["duration_s"], found["duration_s"])
        self.assertAlmostEqual(alone["arrival"][0], found["arrival"][0], places=10)


class HeldoutRunnerTest(unittest.TestCase):
    def sealed(self, work):
        # A stand-in protocol with its own salt: no registered held-out seed is computed.
        protocol = study.load_protocol()
        protocol["status"] = "frozen"
        protocol["seeds"]["heldout"]["salt"] = "unit-test-salt"
        protocol["seeds"]["heldout"]["count"] = 3
        path = work / "protocol.json"
        path.write_text(json.dumps(protocol))
        (work / "freeze.json").write_text(json.dumps({"protocol_sha256": study.protocol_hash(path)}))
        # Every cell selected nothing, so only the real G0 control is simulated.
        synthetic_search(work / "dev", protocol, selected=False)
        record = study.dev_cell(protocol, "G0", 1e-6, "reference", chosen=[(1000.0, 640.0)], extras=False)
        record["distance_index"] = 0
        record["design_sha256"] = study.design_hash(protocol)
        study.put(work / "dev" / "control-G0.json", record)
        return protocol, path, record

    def test_runner_scores_selected_settings_once_and_only_when_sealed_properly(self):
        with tempfile.TemporaryDirectory() as work:
            work = Path(work)
            protocol, path, record = self.sealed(work)
            result = study.heldout(path, work / "dev", work / "heldout")
            scored = json.loads((work / "heldout" / "control-G0.json").read_text())
            self.assertEqual(scored["verdict"], "PASS")
            self.assertEqual(len(scored["seed_list"]), 3)
            self.assertTrue(result["checks"]["V3"])
            self.assertTrue(result["complete"])
            self.assertEqual(result["stage"], "held-out")
            with self.assertRaises(FileExistsError):
                study.heldout(path, work / "dev", work / "heldout")
            # A selected setting that a held-out run finds past a cap is a FAIL, not a crash.
            slow = dict(record, selected=dict(record["selected"], omega_over_2pi_hz=1e-3))
            study.put(work / "dev" / "control-G0.json", slow)
            study.heldout(path, work / "dev", work / "capped")
            capped = json.loads((work / "capped" / "control-G0.json").read_text())
            self.assertEqual((capped["verdict"], capped["skipped"]), ("FAIL", "loss cap"))
            record["design_sha256"] = "0" * 64
            study.put(work / "dev" / "control-G0.json", record)
            with self.assertRaises(ValueError):
                study.heldout(path, work / "dev", work / "again")
            self.assertFalse((work / "again").exists())

    def test_runner_refuses_an_incomplete_or_stale_search_before_any_seed_exists(self):
        with tempfile.TemporaryDirectory() as work:
            work = Path(work)
            protocol, path, _ = self.sealed(work)
            self.assertEqual(study.missing_records(protocol, work / "dev"), [])
            gone = work / "dev" / "cells" / f"{study.cell_label('G2', 7, 'harsh')}.json"
            kept = gone.read_text()
            gone.unlink()
            with self.assertRaises(ValueError):
                study.heldout(path, work / "dev", work / "out")
            self.assertFalse((work / "out").exists())
            gone.write_text(kept)
            stale = work / "dev" / "noiseless" / "G3-d20.json"
            study.put(stale, dict(json.loads(stale.read_text()), design_sha256="0" * 64))
            self.assertEqual(study.missing_records(protocol, work / "dev"), ["noiseless/G3-d20.json"])
            with self.assertRaises(ValueError):
                study.heldout(path, work / "dev", work / "out")
            self.assertFalse((work / "out").exists())

    def test_command_line_refuses_the_draft(self):
        with tempfile.TemporaryDirectory() as work:
            with self.assertRaises(PermissionError):
                study.main(["heldout", str(Path(work) / "dev"), str(Path(work) / "out")])


class AnalysisTest(unittest.TestCase):
    def test_rules_applied_to_a_complete_synthetic_search(self):
        protocol = study.load_protocol()
        with tempfile.TemporaryDirectory() as work:
            work = Path(work)
            synthetic_search(work, protocol)
            result = study.analyze(protocol, work)
        self.assertTrue(result["complete"])
        self.assertTrue(all(result["checks"].values()), result["checks"])
        self.assertEqual(result["H1"], "MICROSCALE ONLY")
        self.assertAlmostEqual(result["limits"]["generous"]["D_star_um"], 10 ** (3 / 8))
        self.assertEqual(result["H2"]["G1"]["verdict"], "CONFIRMED")
        self.assertEqual(result["H2"]["G2"]["verdict"], "CONFIRMED")
        self.assertEqual(result["H2"]["G3"]["verdict"], "INCONCLUSIVE")
        self.assertEqual(result["H3"], "UPHELD")
        self.assertEqual(result["stage"], "development preview, not confirmatory")

    def test_h2_and_h3_are_incomplete_without_every_current_noiseless_record(self):
        protocol = study.load_protocol()
        grid_um = [d / model.MICRON for d in study.distances(protocol)]
        with tempfile.TemporaryDirectory() as work:
            work = Path(work)
            synthetic_search(work, protocol)
            (work / "noiseless" / "G3-d22.json").unlink()
            stale = work / "noiseless" / "G1-d24.json"
            study.put(stale, dict(json.loads(stale.read_text()), design_sha256="0" * 64))
            result = study.analyze(protocol, work)
        self.assertEqual(result["H2"]["G1"]["verdict"], "INCOMPLETE")
        self.assertIsNone(result["H2"]["G1"]["slope"])
        self.assertEqual(result["H2"]["G2"]["verdict"], "CONFIRMED")
        self.assertEqual(result["H2"]["G3"]["verdict"], "INCOMPLETE")
        self.assertEqual(result["H3"], "INCOMPLETE")
        self.assertEqual(result["noiseless_missing"], {"G1": [grid_um[24]], "G2": [], "G3": [grid_um[22]]})
        self.assertFalse(result["checks"]["V5"])


if __name__ == "__main__":
    unittest.main()
