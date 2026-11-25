"""Runner for the empty-middle study (rain-c1-empty-middle-v1).

The protocol is a draft. This file runs development seeds only; the held-out
seeds are generated only from a frozen protocol whose hash matches its freeze
record, and nothing here freezes one.

    python study.py search DIR [--workers 4]   every dev cell, the control and the noiseless series
    python study.py analyze DIR                checks, limits and hypotheses from a search
    python study.py smoke OUT                  the control and a few dev cells
    python study.py cell OUT --design G1 --distance 0 --budget reference
    python study.py noiseless OUT --design G1 --distance 8
    python study.py heldout DEV OUT            refuses until the protocol is frozen
"""

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from functools import lru_cache
from hashlib import sha256
import json
import math
from pathlib import Path
import sys
import time

import numpy as np

import model

HERE = Path(__file__).resolve().parent
PROTOCOL = HERE / "protocol.json"
DESIGNS = ("G1", "G2", "G3")
BUDGETS = ("harsh", "reference", "generous")
UNHASHED = ("status", "registered")


def load_protocol(path=PROTOCOL):
    return json.loads(Path(path).read_text())


def protocol_hash(path=PROTOCOL):
    """SHA-256 of the protocol file's bytes, as its freeze record holds it."""
    return sha256(Path(path).read_bytes()).hexdigest()


def design_hash(protocol):
    """SHA-256 of the protocol without its status and registration date (check V5).

    Freezing changes only those two fields, so a development search run on the
    draft stays bound to the frozen protocol.
    """
    content = {k: v for k, v in protocol.items() if k not in UNHASHED}
    return sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def fit_indices(protocol):
    """Grid indices of the noiseless fit: the 17 distances from 10 um to 1 mm."""
    grid = distances(protocol)
    return [k for k, d in enumerate(grid) if d >= 10 * model.MICRON * (1 - 1e-9)]


def distances(protocol):
    grid = protocol["distances"]
    return [10 ** (k / 8) * model.MICRON for k in range(grid["k_min"], grid["k_max"] + 1)]


def settings(protocol):
    """(omega / 2 pi in Hz, pulse area) for every setting of a cell."""
    search = protocol["search"]["omega_over_2pi_hz"]
    low = math.log10(search["min"])
    high = math.log10(search["max"])
    count = int(round((high - low) * search["per_decade"])) + 1
    freqs = [10 ** (low + j / search["per_decade"]) for j in range(count)]
    areas = protocol["search"]["pulse_areas"]
    return [(f, float(a)) for f in freqs for a in areas]


def budget(protocol, name):
    """A budget in SI units, or the noiseless one."""
    if name == "noiseless":
        ref = protocol["budgets"][protocol["noiseless"]["budget_for_kinetic_and_tunnelling"]]
        return {
            "T2_star_s": math.inf,
            "loss_per_s": 0.0,
            "kinetic": 2 * math.pi * ref["kinetic_hz"],
            "tunnelling": 2 * math.pi * ref["tunnelling_hz"],
            "disorder_per_J": 0.0,
        }
    raw = protocol["budgets"][name]
    return {
        "T2_star_s": raw["T2_star_s"],
        "loss_per_s": raw["loss_per_s"],
        "kinetic": 2 * math.pi * raw["kinetic_hz"],
        "tunnelling": 2 * math.pi * raw["tunnelling_hz"],
        "disorder_per_J": raw["disorder_per_J"],
    }


@lru_cache(maxsize=None)
def draws(seed, sites):
    """Standard normals for one seed: (zA, zB) and one per lattice site."""
    trap, onsite = np.random.SeedSequence(seed).spawn(2)
    z = np.random.default_rng(trap).standard_normal(2)
    w = np.random.default_rng(onsite).standard_normal(sites)
    return z, w


def max_sites(protocol):
    return model.lattice_sites(distances(protocol)[-1])


def dev_seeds(protocol):
    return list(protocol["seeds"]["dev"])


def heldout_seeds(protocol_path=PROTOCOL, freeze_path=None):
    """Held-out seeds, only from a frozen protocol that matches its freeze record."""
    protocol = check_frozen(protocol_path, freeze_path)
    rule = protocol["seeds"]["heldout"]
    salt = rule["salt"]
    return [
        int(sha256(f"{salt}:{i}".encode()).hexdigest()[:8], 16) for i in range(rule["count"])
    ]


def check_frozen(protocol_path=PROTOCOL, freeze_path=None):
    """The protocol, if it is frozen and matches its freeze record."""
    protocol = load_protocol(protocol_path)
    if protocol.get("status") != "frozen":
        raise PermissionError("the protocol is not frozen; held-out seeds stay sealed")
    freeze_path = Path(freeze_path or Path(protocol_path).with_name("freeze.json"))
    if not freeze_path.exists():
        raise PermissionError("no freeze record; held-out seeds stay sealed")
    freeze = json.loads(freeze_path.read_text())
    if freeze.get("protocol_sha256") != protocol_hash(protocol_path):
        raise PermissionError("the protocol does not match its freeze record")
    return protocol


@lru_cache(maxsize=64)
def _guide_spectrum(design, distance, kinetic):
    if design == "G1":
        return model.free_guide_lowest(distance)
    return model.free_guide_fast(distance, kinetic)


@lru_cache(maxsize=512)
def _lattice_spectrum(distance, tunnelling, disorder_per_J, seed, sites):
    if disorder_per_J == 0.0 or seed is None:
        return model.lattice(distance, tunnelling)
    _, w = draws(seed, sites)
    return model.lattice(distance, tunnelling, w * disorder_per_J * tunnelling)


def spectrum(protocol, design, distance, conditions, seed):
    if design == "G0":
        return model.single_mode()
    if design in ("G1", "G2"):
        return _guide_spectrum(design, distance, conditions["kinetic"])
    return _lattice_spectrum(
        distance, conditions["tunnelling"], conditions["disorder_per_J"], seed, max_sites(protocol)
    )


def offsets(seed, conditions, sites):
    if seed is None or math.isinf(conditions["T2_star_s"]):
        return np.zeros(2)
    z, _ = draws(seed, sites)
    return z / conditions["T2_star_s"]


def margin(F, M, protocol):
    t = protocol["thresholds"]
    return min((F - t["arrival_min"]) / (1 - t["arrival_min"]), (t["middle_max"] - M) / t["middle_max"])


def _bucket(value, edges):
    for edge in edges:
        if value <= edge:
            return edge
    return value


def run_settings(protocol, design, distance, conditions, chosen, seeds, reverse=False, window=None, step_factor=1):
    """Run settings over seeds; returns one entry per setting.

    chosen is a list of (f, area). Each entry holds the setting, T, the skip
    reason if it was not run, and per-seed arrival and middle traces if it was.
    """
    registered = protocol["model"]["explicit_window"]
    window = window or registered
    elimination_cap = protocol["model"]["elimination_cap"]
    # A wider window for check V2 brings its mode cap along with it.
    cap = protocol["model"]["explicit_mode_cap"] * window // registered
    loss = conditions["loss_per_s"]
    sites = max_sites(protocol)
    samples = protocol["model"]["samples"]
    entries = []
    jobs = []
    for f, area in chosen:
        omega = 2 * math.pi * f
        duration = area / omega
        entry = {"omega_over_2pi_hz": f, "area": area, "duration_s": duration}
        entries.append(entry)
        survive = math.exp(-loss * duration)
        entry["survival"] = survive
        if survive < 0.9:
            entry["skipped"] = "loss cap"
            continue
        rows = []
        cache = {}
        for seed in seeds:
            spec = spectrum(protocol, design, distance, conditions, seed)
            if id(spec) not in cache:
                cache[id(spec)] = model.partition(spec, omega, window)
            part = cache[id(spec)]
            if part.energies.size > cap:
                entry["skipped"] = "mode cap"
                break
            off = offsets(seed, conditions, sites)
            steps = model.required_steps(part, off, duration, samples) * step_factor
            rows.append((part, off, omega, duration, steps))
        if "skipped" in entry:
            continue
        jobs.append((entry, rows))
    # Group rows by step count and explicit mode count so each batch shares a grid.
    groups = {}
    intervals = samples - 1
    for entry, rows in jobs:
        per = max(r[4] for r in rows) // intervals
        per = 1 << int(math.ceil(math.log2(per)))
        modes = _bucket(max(r[0].energies.size for r in rows), (4, 16, 64, 400))
        groups.setdefault((per * intervals, modes), []).append((entry, rows))
    for (steps, _), members in sorted(groups.items()):
        flat = [(entry, row) for entry, rows in members for row in rows]
        results = {}
        for start in range(0, len(flat), 256):
            batch = flat[start : start + 256]
            run = model.propagate(
                [row[0] for _, row in batch],
                np.array([row[1] for _, row in batch]),
                [row[2] for _, row in batch],
                [row[3] for _, row in batch],
                steps,
                samples,
                reverse,
            )
            for i, (entry, _) in enumerate(batch):
                results.setdefault(id(entry), []).append(
                    (run.arrival[i], run.middle[i], run.norm_error[i], run.explicit_modes[i], run.eliminated_ratio[i])
                )
        for entry, _ in members:
            got = results[id(entry)]
            entry["explicit_modes"] = int(max(g[3] for g in got))
            entry["steps"] = int(steps)
            entry["eliminated_ratio"] = float(max(g[4] for g in got))
            if entry["eliminated_ratio"] > elimination_cap:
                # Elimination has left its range on some seed. Such a setting
                # cannot pass (see the protocol), and its numbers are not kept.
                entry["skipped"] = "elimination cap"
                continue
            entry["arrival"] = np.array([g[0] for g in got])
            entry["middle"] = np.stack([g[1] for g in got])
            entry["norm_error"] = float(max(g[2] for g in got))
    for entry in entries:
        if "arrival" in entry:
            entry["F"] = float(np.mean(entry["arrival"]) * entry["survival"])
            entry["M"] = float(np.max(np.mean(entry["middle"], axis=0)))
            entry["margin"] = margin(entry["F"], entry["M"], protocol)
    return entries


def select(entries):
    """Largest dev margin, ties to shorter T; None if nothing was run."""
    ran = [e for e in entries if "margin" in e]
    if not ran:
        return None
    return max(ran, key=lambda e: (round(e["margin"], 12), -e["duration_s"]))


def bootstrap(arrival, middle, survival, protocol):
    """95% percentile intervals of F and M over seeds."""
    spec = protocol["seeds"]["bootstrap"]
    rng = np.random.default_rng(spec["seed"])
    seeds = arrival.size
    resamples = spec["resamples"]
    F = np.empty(resamples)
    M = np.empty(resamples)
    for start in range(0, resamples, 1000):
        count = min(1000, resamples - start)
        picks = rng.integers(0, seeds, size=(count, seeds))
        weights = np.zeros((count, seeds))
        np.add.at(weights, (np.arange(count)[:, None], picks), 1.0 / seeds)
        F[start : start + count] = weights @ arrival * survival
        M[start : start + count] = np.max(weights @ middle, axis=1)
    lo, hi = np.percentile(F, [2.5, 97.5])
    mlo, mhi = np.percentile(M, [2.5, 97.5])
    return {"F": [float(lo), float(hi)], "M": [float(mlo), float(mhi)]}


def cell_verdict(interval, protocol, all_capped=False):
    t = protocol["thresholds"]
    if all_capped:
        return "FAIL"
    (Flo, Fhi), (Mlo, Mhi) = interval["F"], interval["M"]
    if Flo >= t["arrival_min"] and Mhi < t["middle_max"]:
        return "PASS"
    if Fhi < t["arrival_min"] or Mlo >= t["middle_max"]:
        return "FAIL"
    return "INCONCLUSIVE"


def limits(verdicts, grid):
    """d* (largest contiguous PASS from the start) and u (shortest FAIL)."""
    d_star = None
    for d, v in zip(grid, verdicts):
        if v != "PASS":
            break
        d_star = d
    u = next((d for d, v in zip(grid, verdicts) if v == "FAIL"), None)
    return d_star, u


def h1_verdict(per_design, checks_ok, anchor_ok, complete, line, grid):
    """per_design maps design to its cell verdicts at the verdict budget."""
    if not checks_ok:
        return "INVALID"
    if not complete:
        return "INCOMPLETE"
    within = [i for i, d in enumerate(grid) if d <= line * (1 + 1e-9)]
    if any(all(v[i] == "PASS" for i in within) for v in per_design.values()):
        return "OPEN AT SCALE"
    if all(any(v[i] == "FAIL" for i in within) for v in per_design.values()) and anchor_ok:
        return "MICROSCALE ONLY"
    return "INCONCLUSIVE"


def h2_verdict(treq, grid, predicted, tolerance):
    """treq maps grid index to T_req or None, over the fit distances."""
    if any(treq.get(i) is None for i in grid):
        return "INCONCLUSIVE", None
    x = np.log([g for g in grid.values()])
    y = np.log([treq[i] for i in grid])
    slope = float(np.polyfit(x, y, 1)[0])
    return ("CONFIRMED" if abs(slope - predicted) <= tolerance else "NOT CONFIRMED"), slope


def h3_verdict(treq, indices):
    found = [treq.get(i) is not None for i in indices]
    if all(found):
        return "CONTRADICTED"
    if not any(found):
        return "UPHELD"
    return "INCONCLUSIVE"


def noiseless_treq(protocol, design, distance, batch=64):
    """Shortest T among settings that pass without noise, trying T in order.

    Settings run in batches of increasing T; the first that passes in that
    order is the answer, exactly as if they had been tried one at a time.
    Returns (passing entry or None, entries tried, outcome).
    """
    conditions = budget(protocol, "noiseless")
    t = protocol["thresholds"]
    limit = protocol["noiseless"]["max_duration_s"]
    ordered = sorted(
        (s for s in settings(protocol) if s[1] / (2 * math.pi * s[0]) <= limit),
        key=lambda s: s[1] / (2 * math.pi * s[0]),
    )
    tried = []
    for start in range(0, len(ordered), batch):
        for entry in run_settings(protocol, design, distance, conditions, ordered[start : start + batch], [None]):
            tried.append(entry)
            if "arrival" in entry and entry["arrival"][0] >= t["arrival_min"] and entry["M"] < t["middle_max"]:
                return entry, tried, "found"
    return None, tried, "none"


def _summary(entry):
    keep = ("omega_over_2pi_hz", "area", "duration_s", "survival", "skipped", "F", "M", "margin", "steps", "explicit_modes", "eliminated_ratio", "norm_error")
    return {k: entry[k] for k in keep if k in entry}


def _round(value):
    return None if value is None else float(f"{value:.7g}")


def _table(entries):
    """Every setting of a cell, as columns in the order of settings(protocol)."""
    return {
        "status": [e.get("skipped", "run") for e in entries],
        "F": [_round(e.get("F")) for e in entries],
        "M": [_round(e.get("M")) for e in entries],
        "steps": [e.get("steps") for e in entries],
        "explicit_modes": [e.get("explicit_modes") for e in entries],
    }


def dev_cell(protocol, design, distance, budget_name, seeds=None, chosen=None, extras=True):
    """Search one cell on dev seeds and run the selected setting's checks."""
    seeds = seeds or dev_seeds(protocol)
    conditions = budget(protocol, budget_name)
    chosen = chosen or settings(protocol)
    started = time.process_time()
    entries = run_settings(protocol, design, distance, conditions, chosen, seeds)
    best = select(entries)
    out = {
        "design": design,
        "distance_um": distance / model.MICRON,
        "budget": budget_name,
        "seeds": "dev",
        "seed_list": list(seeds),
        "settings": _table(entries),
        "max_norm_error": max((e["norm_error"] for e in entries if "norm_error" in e), default=0.0),
    }
    if best is None:
        out["selected"] = None
        out["dev_verdict"] = "FAIL"
        out["cpu_s"] = time.process_time() - started
        return out
    out["selected"] = _summary(best)
    out["dev_interval"] = bootstrap(best["arrival"], best["middle"], best["survival"], protocol)
    out["dev_verdict"] = cell_verdict(out["dev_interval"], protocol)
    if extras:
        setting = [(best["omega_over_2pi_hz"], best["area"])]
        first = seeds[:1]
        base = run_settings(protocol, design, distance, conditions, setting, first)[0]
        wide = run_settings(protocol, design, distance, conditions, setting, first, window=2 * protocol["model"]["explicit_window"])[0]
        fine = run_settings(protocol, design, distance, conditions, setting, first, step_factor=2)[0]
        rev = run_settings(protocol, design, distance, conditions, setting, seeds, reverse=True)[0]
        out["V2_window"] = _delta(base, wide)
        out["V8_steps"] = _delta(base, fine)
        if "arrival" in rev:
            rev_interval = bootstrap(rev["arrival"], rev["middle"], rev["survival"], protocol)
            out["V4_reversed"] = {"interval": rev_interval, "fail_on_M": rev_interval["M"][0] >= protocol["thresholds"]["middle_max"]}
        elif rev.get("skipped") == "elimination cap":
            # Past the cap, the eliminated modes alone hold over a tenth of the trap
            # population on some seed: the middle is far from empty.
            out["V4_reversed"] = {"skipped": "elimination cap", "fail_on_M": True}
    out["cpu_s"] = time.process_time() - started
    return out


def _delta(a, b):
    if "arrival" not in a or "arrival" not in b:
        return {"evaluable": False, "reason": a.get("skipped") or b.get("skipped")}
    return {
        "evaluable": True,
        "F": abs(float(a["arrival"][0] - b["arrival"][0])) * a["survival"],
        "M": abs(float(np.max(a["middle"][0]) - np.max(b["middle"][0]))),
    }


def numerics_ok(delta, record, protocol):
    """Checks V2 and V8 for one cell's selected setting.

    A change passes below the check tolerance, or below a tenth of the distance
    from the nearer bound of the cell's dev interval to its threshold, where it
    cannot move the verdict.
    """
    if not delta or not delta.get("evaluable"):
        return False
    t = protocol["thresholds"]
    tolerance = protocol["model"]["check_tolerance"]
    interval = record["dev_interval"]
    room_F = min(abs(b - t["arrival_min"]) for b in interval["F"]) / 10
    room_M = min(abs(b - t["middle_max"]) for b in interval["M"]) / 10
    return delta["F"] < max(tolerance, room_F) and delta["M"] < max(tolerance, room_M)


def _dumps(value, level=0):
    """JSON with objects indented and lists of plain values on one line."""
    pad = "  " * (level + 1)
    end = "  " * level
    if isinstance(value, dict):
        if not value:
            return "{}"
        items = [f"{pad}{json.dumps(k)}: {_dumps(value[k], level + 1)}" for k in sorted(value)]
        return "{\n" + ",\n".join(items) + "\n" + end + "}"
    if isinstance(value, (list, tuple)):
        if all(not isinstance(v, (dict, list, tuple)) for v in value):
            return json.dumps(list(value), separators=(", ", ": "), allow_nan=False)
        return "[\n" + ",\n".join(pad + _dumps(v, level + 1) for v in value) + "\n" + end + "]"
    return json.dumps(value, allow_nan=False)


def put(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_dumps(value) + "\n")


def cell_label(design, index, budget_name):
    return f"{design}-d{index:02d}-{budget_name}"


def _cell_job(job):
    design, index, budget_name = job
    protocol = load_protocol()
    record = dev_cell(protocol, design, distances(protocol)[index], budget_name)
    record["distance_index"] = index
    record["design_sha256"] = design_hash(protocol)
    return Path("cells") / f"{cell_label(design, index, budget_name)}.json", record


def _control_job(_):
    protocol = load_protocol()
    areas = [(1000.0, float(a)) for a in protocol["search"]["pulse_areas"]]
    record = dev_cell(protocol, "G0", distances(protocol)[0], "reference", chosen=areas)
    record["distance_index"] = 0
    record["check"] = "V3: G0 at 1 kHz with its dev-selected pulse area, reference budget"
    record["design_sha256"] = design_hash(protocol)
    return Path("control-G0.json"), record


def _noiseless_job(job):
    design, index = job
    protocol = load_protocol()
    started = time.process_time()
    found, tried, how = noiseless_treq(protocol, design, distances(protocol)[index])
    record = {
        "design": design,
        "distance_index": index,
        "distance_um": distances(protocol)[index] / model.MICRON,
        "T_req_s": found["duration_s"] if found else None,
        "outcome": how,
        "passing_setting": _summary(found) if found else None,
        "tried": {
            "duration_s": [_round(e["duration_s"]) for e in tried],
            "omega_over_2pi_hz": [_round(e["omega_over_2pi_hz"]) for e in tried],
            "area": [e["area"] for e in tried],
            **{k: v for k, v in _table(tried).items() if k != "explicit_modes"},
        },
        "max_norm_error": max((e["norm_error"] for e in tried if "norm_error" in e), default=0.0),
        "cpu_s": time.process_time() - started,
        "design_sha256": design_hash(protocol),
    }
    return Path("noiseless") / f"{design}-d{index:02d}.json", record


def search_jobs(protocol):
    """Every development job, heaviest first so the workers stay busy."""
    jobs = [(_noiseless_job, (design, k)) for k in reversed(fit_indices(protocol)) for design in DESIGNS]
    jobs += [(_cell_job, (design, k, b)) for design in ("G1", "G2", "G3") for k in range(len(distances(protocol))) for b in BUDGETS]
    jobs.append((_control_job, None))
    return jobs


def _expected_path(fn, job):
    if fn is _cell_job:
        return Path("cells") / f"{cell_label(*job)}.json"
    if fn is _noiseless_job:
        return Path("noiseless") / f"{job[0]}-d{job[1]:02d}.json"
    return Path("control-G0.json")


def required_records(protocol):
    """Paths of every record a complete development search writes."""
    return [_expected_path(fn, job) for fn, job in search_jobs(protocol)]


def missing_records(protocol, dev_dir):
    """Required development records that are absent or carry another design hash."""
    digest = design_hash(protocol)
    return [str(rel) for rel in required_records(protocol) if not _current(Path(dev_dir) / rel, digest)]


def _current(path, digest):
    if not path.exists():
        return False
    return json.loads(path.read_text()).get("design_sha256") == digest


def search(protocol, out_dir, workers=1):
    """Run every dev job not already in out_dir under this protocol, then analyse."""
    out_dir = Path(out_dir)
    digest = design_hash(protocol)
    todo = [(fn, job) for fn, job in search_jobs(protocol) if not _current(out_dir / _expected_path(fn, job), digest)]
    print(f"{len(todo)} jobs to run", flush=True)
    if workers <= 1:
        for fn, job in todo:
            rel, record = fn(job)
            put(out_dir / rel, record)
            print(rel, flush=True)
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(fn, job): job for fn, job in todo}
            for future in as_completed(futures):
                rel, record = future.result()
                put(out_dir / rel, record)
                print(rel, record.get("dev_verdict", record.get("outcome")), flush=True)
    result = analyze(protocol, out_dir)
    put(out_dir / "analysis.json", result)
    return result


def _load_dir(directory):
    directory = Path(directory)
    cells = {}
    for path in sorted((directory / "cells").glob("*.json")):
        record = json.loads(path.read_text())
        cells[(record["design"], record["distance_index"], record["budget"])] = record
    noiseless = {}
    for path in sorted((directory / "noiseless").glob("*.json")):
        record = json.loads(path.read_text())
        noiseless[(record["design"], record["distance_index"])] = record
    control_path = directory / "control-G0.json"
    control = json.loads(control_path.read_text()) if control_path.exists() else None
    return cells, noiseless, control


def analyze(protocol, dev_dir, heldout_dir=None):
    """Checks V1 to V8, limits and the three hypotheses.

    Without held-out records this is a development preview of the same rules:
    it says nothing confirmatory.
    """
    digest = design_hash(protocol)
    t = protocol["thresholds"]
    grid_um = [d / model.MICRON for d in distances(protocol)]
    cells, noiseless, control = _load_dir(dev_dir)
    held_cells, _, held_control = _load_dir(heldout_dir) if heldout_dir else ({}, {}, None)
    dev_records = list(cells.values()) + list(noiseless.values()) + ([control] if control else [])
    every = dev_records + list(held_cells.values()) + ([held_control] if held_control else [])
    selected = [(k, r) for k, r in cells.items() if r.get("selected")]
    if control and control.get("selected"):
        selected.append((("G0", 0, "reference"), control))

    def label(key):
        return cell_label(*key)

    v2_fail = [label(k) for k, r in selected if not numerics_ok(r.get("V2_window"), r, protocol)]
    v8_fail = [label(k) for k, r in selected if not numerics_ok(r.get("V8_steps"), r, protocol)]
    v4_fail = [label(k) for k, r in selected if not r.get("V4_reversed", {}).get("fail_on_M", False)]
    dev_set = set(dev_seeds(protocol))
    held_seed_lists = [r.get("seed_list", []) for r in held_cells.values()]

    def verdict(key):
        if heldout_dir:
            record = held_cells.get(key)
            return record["verdict"] if record else None
        record = cells.get(key)
        return record["dev_verdict"] if record else None

    control_verdict = (held_control or {}).get("verdict") if heldout_dir else (control or {}).get("dev_verdict")
    checks = {
        "V1": all(r.get("max_norm_error", 0.0) <= 1e-8 for r in every),
        "V2": not v2_fail,
        "V3": control_verdict == "PASS",
        "V4": not v4_fail,
        "V5": bool(every) and all(r.get("design_sha256") == digest for r in every),
        "V6": all(set(r.get("seed_list", [])) <= dev_set for r in dev_records)
        and not any(set(s) & dev_set for s in held_seed_lists),
        "V7": any(verdict((g, 0, "generous")) == "PASS" for g in DESIGNS),
        "V8": not v8_fail,
    }
    keys = [(g, k, b) for g in DESIGNS for k in range(len(grid_um)) for b in BUDGETS]
    fit = fit_indices(protocol)
    complete = (
        all(key in cells for key in keys)
        and control is not None
        and all((g, k) in noiseless for g in DESIGNS for k in fit)
        and (not heldout_dir or (all(key in held_cells for key in keys) and held_control is not None))
    )
    per_budget = {}
    for b in BUDGETS:
        designs = {}
        for g in DESIGNS:
            verdicts = [verdict((g, k, b)) for k in range(len(grid_um))]
            d_star, u = limits(verdicts, grid_um)
            designs[g] = {"verdicts": verdicts, "d_star_um": d_star, "u_um": u}
        stars = [v["d_star_um"] for v in designs.values() if v["d_star_um"] is not None]
        per_budget[b] = {"designs": designs, "D_star_um": max(stars) if stars else None}
    line = protocol["macroscopic_line_um"]
    chosen = protocol["verdict_budget"]
    gating = ("V1", "V2", "V4", "V5", "V6", "V8")
    h1 = h1_verdict(
        {g: per_budget[chosen]["designs"][g]["verdicts"] for g in DESIGNS},
        all(checks[c] for c in gating),
        checks["V3"] and checks["V7"],
        complete,
        line,
        grid_um,
    )
    fit_grid = {k: grid_um[k] for k in fit}
    current = {key: r for key, r in noiseless.items() if r.get("design_sha256") == digest}
    absent = {g: [k for k in fit if (g, k) not in current] for g in DESIGNS}
    treq = {g: {k: (current.get((g, k)) or {}).get("T_req_s") for k in fit} for g in DESIGNS}
    h2 = {}
    for g in DESIGNS:
        if absent[g]:
            outcome, slope = "INCOMPLETE", None
        else:
            outcome, slope = h2_verdict(treq[g], fit_grid, protocol["predicted_slopes"][g], protocol["noiseless"]["tolerance"])
        h2[g] = {"verdict": outcome, "slope": slope, "predicted": protocol["predicted_slopes"][g]}
    cap_s = protocol["compute_cap_cpu_hours_per_cell"] * 3600
    return {
        "stage": "held-out" if heldout_dir else "development preview, not confirmatory",
        "design_sha256": digest,
        "complete": complete,
        "checks": checks,
        "check_failures": {"V2": v2_fail, "V4": v4_fail, "V8": v8_fail},
        "limits": per_budget,
        "H1": h1,
        "H2": h2,
        "H3": "INCOMPLETE" if absent["G3"] else h3_verdict(treq["G3"], fit),
        "noiseless_missing": {g: [grid_um[k] for k in absent[g]] for g in DESIGNS},
        "noiseless_T_req_s": {g: {f"{grid_um[k]:.4g}": treq[g][k] for k in fit} for g in DESIGNS},
        "compute_cap_exceeded": [label(k) for k, r in cells.items() if r.get("cpu_s", 0.0) > cap_s],
        "cpu_hours": sum(r.get("cpu_s", 0.0) for r in dev_records) / 3600,
        "thresholds": t,
    }


def heldout(protocol_path, dev_dir, out_dir, freeze_path=None):
    """The one held-out run: each dev-selected setting, scored once on held-out seeds.

    Refuses unless the protocol is frozen and matches its freeze record, out_dir
    is empty, and every record of a complete development search is present and
    carries the frozen protocol's design hash.
    """
    protocol = check_frozen(protocol_path, freeze_path)
    digest = design_hash(protocol)
    out_dir = Path(out_dir)
    if out_dir.exists() and any(out_dir.iterdir()):
        raise FileExistsError("the held-out run happens once; its output directory is not empty")
    # Everything is checked before a held-out seed exists or a file is written,
    # so a bad input leaves the held-out split unexposed.
    missing = missing_records(protocol, dev_dir)
    if missing:
        raise ValueError(f"the development search is incomplete or stale: {len(missing)} records, first {missing[0]}")
    cells, _, control = _load_dir(dev_dir)
    records = [(Path("cells") / f"{cell_label(*k)}.json", r) for k, r in sorted(cells.items())]
    records.append((Path("control-G0.json"), control))
    for _, record in records:
        if record.get("design_sha256") != digest:
            raise ValueError(f"{record['design']} d{record['distance_index']:02d} was selected under another protocol")
    seeds = heldout_seeds(protocol_path, freeze_path)
    if set(seeds) & set(dev_seeds(protocol)):
        raise ValueError("a held-out seed is also a development seed")
    grid = distances(protocol)
    for rel, record in records:
        out = {k: record[k] for k in ("design", "distance_index", "distance_um", "budget")}
        out.update({"seeds": "heldout", "seed_list": seeds, "design_sha256": digest, "selected": record["selected"]})
        if record["selected"] is None:
            out.update({"verdict": cell_verdict(None, protocol, all_capped=True), "max_norm_error": 0.0})
        else:
            setting = [(record["selected"]["omega_over_2pi_hz"], record["selected"]["area"])]
            conditions = budget(protocol, record["budget"])
            entry = run_settings(protocol, record["design"], grid[record["distance_index"]], conditions, setting, seeds)[0]
            if "arrival" not in entry:
                # A held-out disorder draw can push the selected setting past a cap.
                out.update({"skipped": entry["skipped"], "verdict": "FAIL", "max_norm_error": 0.0})
                put(out_dir / rel, out)
                continue
            interval = bootstrap(entry["arrival"], entry["middle"], entry["survival"], protocol)
            out.update({
                "F": entry["F"],
                "M": entry["M"],
                "interval": interval,
                "verdict": cell_verdict(interval, protocol),
                "max_norm_error": entry["norm_error"],
            })
        put(out_dir / rel, out)
    result = analyze(protocol, dev_dir, out_dir)
    put(out_dir / "analysis.json", result)
    return result


def smoke(protocol, out_dir, cells):
    """The G0 control and a set of dev cells, written as a search would write them."""
    out_dir = Path(out_dir)
    jobs = [(_control_job, None)] + [(_cell_job, cell) for cell in cells]
    for fn, job in jobs:
        rel, record = fn(job)
        put(out_dir / rel, record)
        print(rel, record["dev_verdict"], flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    se = sub.add_parser("search")
    se.add_argument("out", type=Path)
    se.add_argument("--workers", type=int, default=1)
    an = sub.add_parser("analyze")
    an.add_argument("out", type=Path)
    s = sub.add_parser("smoke")
    s.add_argument("out", type=Path)
    c = sub.add_parser("cell")
    c.add_argument("out", type=Path)
    c.add_argument("--design", required=True, choices=("G0",) + DESIGNS)
    c.add_argument("--distance", type=int, required=True)
    c.add_argument("--budget", required=True, choices=BUDGETS)
    n = sub.add_parser("noiseless")
    n.add_argument("out", type=Path)
    n.add_argument("--design", required=True, choices=DESIGNS)
    n.add_argument("--distance", type=int, required=True)
    h = sub.add_parser("heldout")
    h.add_argument("dev", type=Path)
    h.add_argument("out", type=Path)
    args = parser.parse_args(argv)
    protocol = load_protocol()
    if args.command == "heldout":
        heldout(PROTOCOL, args.dev, args.out)  # raises unless the protocol is frozen and matches its record
    elif args.command == "search":
        result = search(protocol, args.out, args.workers)
        print(json.dumps({k: result[k] for k in ("complete", "checks", "H1", "H2", "H3")}, indent=2))
    elif args.command == "analyze":
        result = analyze(protocol, args.out)
        put(args.out / "analysis.json", result)
        print(json.dumps({k: result[k] for k in ("complete", "checks", "H1", "H2", "H3")}, indent=2))
    elif args.command == "smoke":
        smoke(protocol, args.out, [(d, 0, b) for d in DESIGNS for b in ("reference", "generous")] + [(d, 8, "reference") for d in DESIGNS])
    elif args.command == "cell":
        record = dev_cell(protocol, args.design, distances(protocol)[args.distance], args.budget)
        record["distance_index"] = args.distance
        record["design_sha256"] = design_hash(protocol)
        put(args.out, record)
        print(record["dev_verdict"])
    elif args.command == "noiseless":
        _, record = _noiseless_job((args.design, args.distance))
        put(args.out, record)
        print(record["T_req_s"], record["outcome"])


if __name__ == "__main__":
    main()
