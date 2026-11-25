"""Runner for the empty-middle study (rain-c1-empty-middle-v1).

The protocol is a draft. This file runs development seeds only; the held-out
seeds are generated only from a frozen protocol whose hash matches its freeze
record, and nothing here freezes one.

    python study.py smoke OUT        controls and a few dev cells
    python study.py cell OUT --design G1 --distance 0 --budget reference
    python study.py noiseless OUT --design G1 --distance 8
"""

import argparse
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


def load_protocol(path=PROTOCOL):
    return json.loads(Path(path).read_text())


def protocol_hash(path=PROTOCOL):
    return sha256(Path(path).read_bytes()).hexdigest()


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
    protocol = load_protocol(protocol_path)
    if protocol.get("status") != "frozen":
        raise PermissionError("the protocol is not frozen; held-out seeds stay sealed")
    freeze_path = Path(freeze_path or Path(protocol_path).with_name("freeze.json"))
    if not freeze_path.exists():
        raise PermissionError("no freeze record; held-out seeds stay sealed")
    freeze = json.loads(freeze_path.read_text())
    if freeze.get("protocol_sha256") != protocol_hash(protocol_path):
        raise PermissionError("the protocol does not match its freeze record")
    rule = protocol["seeds"]["heldout"]
    salt = rule["salt"]
    return [
        int(sha256(f"{salt}:{i}".encode()).hexdigest()[:8], 16) for i in range(rule["count"])
    ]


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
    window = window or protocol["model"]["explicit_window"]
    cap = protocol["model"]["explicit_mode_cap"]
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
                    (run.arrival[i], run.middle[i], run.norm_error[i], run.explicit_modes[i])
                )
        for entry, _ in members:
            got = results[id(entry)]
            entry["arrival"] = np.array([g[0] for g in got])
            entry["middle"] = np.stack([g[1] for g in got])
            entry["norm_error"] = float(max(g[2] for g in got))
            entry["explicit_modes"] = int(max(g[3] for g in got))
            entry["steps"] = int(steps)
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


def noiseless_treq(protocol, design, distance, max_settings=None):
    """Shortest T among settings that pass without noise, trying T in order."""
    conditions = budget(protocol, "noiseless")
    t = protocol["thresholds"]
    limit = protocol["noiseless"]["max_duration_s"]
    ordered = sorted(
        (s for s in settings(protocol) if s[1] / (2 * math.pi * s[0]) <= limit),
        key=lambda s: s[1] / (2 * math.pi * s[0]),
    )
    tried = []
    for count, setting in enumerate(ordered):
        if max_settings is not None and count >= max_settings:
            return None, tried, "stopped early"
        entry = run_settings(protocol, design, distance, conditions, [setting], [None])[0]
        tried.append(_summary(entry))
        if "arrival" not in entry:
            continue
        if entry["arrival"][0] >= t["arrival_min"] and entry["M"] < t["middle_max"]:
            return entry["duration_s"], tried, "found"
    return None, tried, "none"


def _summary(entry):
    keep = ("omega_over_2pi_hz", "area", "duration_s", "survival", "skipped", "F", "M", "margin", "steps", "explicit_modes", "norm_error")
    return {k: entry[k] for k in keep if k in entry}


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
        "settings": [_summary(e) for e in entries],
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


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")


def smoke(protocol, out_dir, cells):
    """Controls on G0 and a set of dev cells; every record carries the protocol hash."""
    digest = protocol_hash()
    grid = distances(protocol)
    records = []
    g0 = dev_cell(protocol, "G0", grid[0], "reference", chosen=[(1000.0, float(a)) for a in protocol["search"]["pulse_areas"]])
    g0["check"] = "V3 preview on dev seeds"
    records.append(("G0-control-reference", g0))
    for design, k, name in cells:
        records.append((f"{design}-d{k:02d}-{name}", dev_cell(protocol, design, grid[k], name)))
    summary = {"protocol_sha256": digest, "status": protocol["status"], "seeds": "dev only", "cells": {}}
    for label, record in records:
        record["protocol_sha256"] = digest
        put(out_dir / f"{label}.json", record)
        summary["cells"][label] = {
            "dev_verdict": record["dev_verdict"],
            "selected": record["selected"],
            "dev_interval": record.get("dev_interval"),
            "V2_window": record.get("V2_window"),
            "V8_steps": record.get("V8_steps"),
            "V4_reversed_fail_on_M": record.get("V4_reversed", {}).get("fail_on_M"),
            "max_norm_error": record["max_norm_error"],
            "cpu_s": record["cpu_s"],
        }
        print(label, record["dev_verdict"], flush=True)
    put(out_dir / "summary.json", summary)
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("smoke")
    s.add_argument("out", type=Path)
    c = sub.add_parser("cell")
    c.add_argument("out", type=Path)
    c.add_argument("--design", required=True, choices=("G0",) + DESIGNS)
    c.add_argument("--distance", type=int, required=True)
    c.add_argument("--budget", required=True, choices=("harsh", "reference", "generous"))
    n = sub.add_parser("noiseless")
    n.add_argument("out", type=Path)
    n.add_argument("--design", required=True, choices=DESIGNS)
    n.add_argument("--distance", type=int, required=True)
    h = sub.add_parser("heldout")
    h.add_argument("out", type=Path)
    args = parser.parse_args(argv)
    protocol = load_protocol()
    if args.command == "heldout":
        heldout_seeds()  # raises unless the protocol is frozen and matches its record
        sys.exit("the held-out runner is written at the freeze, not before it")
    if args.command == "smoke":
        cells = [(d, 0, b) for d in DESIGNS for b in ("reference", "generous")]
        cells += [(d, 8, "reference") for d in DESIGNS]
        smoke(protocol, args.out, cells)
    elif args.command == "cell":
        record = dev_cell(protocol, args.design, distances(protocol)[args.distance], args.budget)
        record["protocol_sha256"] = protocol_hash()
        put(args.out, record)
        print(record["dev_verdict"])
    elif args.command == "noiseless":
        d = distances(protocol)[args.distance]
        treq, tried, how = noiseless_treq(protocol, args.design, d)
        put(args.out, {"design": args.design, "distance_um": d / model.MICRON, "T_req_s": treq, "outcome": how, "tried": tried, "protocol_sha256": protocol_hash()})
        print(treq, how)


if __name__ == "__main__":
    main()
