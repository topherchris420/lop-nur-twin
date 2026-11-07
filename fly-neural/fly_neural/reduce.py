"""Reduced circuits: the part of the whole brain a stimulus regime makes spike.

In Shiu et al.'s model a neuron acts on others only through its spikes: a
neuron that never spikes changes nothing downstream. So a network restricted
to the neurons that spike under a regime, together with the driven inputs and
the readout, reproduces the whole brain spike for spike on any input whose
spiking set it contains. That is a claim about this model, checked here, not
about the fly.

``reduce`` runs the whole brain on a development regime (``dev`` in the
config: sugar at fixed rates and in pulses), keeps every neuron that spiked in
any trial, and cuts the connectome down to those neurons and the synapses
among them, in the original order. ``check`` then runs the whole brain and the
cut on a held-out regime (new rates, ramps, steps, new seeds) with the same
random draws and compares every kept neuron's spike count, and counts the
neurons outside the cut that spiked (closure violations).

The cut is exact under the integrator's own order of operations when the
kept neurons keep their relative order: spikes are gathered in the order the
neurons first left rest, and each target sums its inputs in that order, so
restricting both to the kept neurons changes no floating-point sum.

The circuit is a connectivity table derived from FlyWire data, so it is
written under the data directory (``$FLY_NEURAL_DATA/reduced/``), outside the
repository, as the connectome is. The sealed result in the repository names
its SHA-256; ``reduce`` from the same pinned data reproduces it byte for byte.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import numpy as np

from . import connectome as cx
from . import lif
from .experiments import seed_of
from .params import LIFParams
from .populations import resolve
from .record import canonical, code_watch, environment, sealed
from .resources import Budget, Meter, machine

CIRCUIT_SCHEMA = "connectome-reduced-circuit/v1"
RESULT_SCHEMA = "fly-neural-result/v1"


def _stimulus(cond: dict, idx: np.ndarray) -> lif.Stimulus:
    """A condition's sugar input: a constant ``rate_hz`` or a ``schedule`` of rates per bin."""
    if "rate_hz" in cond:
        return lif.Stimulus(poisson=[lif.Poisson(idx, float(cond["rate_hz"]), label="input")])
    sch = cond["schedule"]
    return lif.Stimulus(poisson=[lif.Poisson(idx, np.asarray(sch["rates_hz"], dtype=np.float64), bin_ms=float(sch["bin_ms"]), label="input")])


def spiking_set(net: lif.Network, inputs: np.ndarray, readout: np.ndarray, conds: list[dict], cfg: dict, split: str, budget: Budget | None = None, log=print) -> tuple[np.ndarray, list[dict]]:
    """Every neuron that spiked in any trial of ``conds``, and each condition's readout rate."""
    spiked = np.zeros(net.n, dtype=bool)
    rows = []
    for cond in conds:
        counts = []
        for k in range(int(cfg.get("cut_trials", cfg["trials"]))):
            sim_seed = seed_of(int(cfg["seeds"][split]), cond["name"], k)
            t, _ = lif.run(net, _stimulus(cond, inputs), cfg["duration_ms"], rng=np.random.default_rng(sim_seed), budget=budget)
            spiked |= t.counts > 0
            counts.append(int(t.counts[readout].sum()))
        rate = float(np.mean(counts)) / readout.size / (cfg["duration_ms"] / 1000.0)
        rows.append({"condition": cond["name"], "readout_hz": round(rate, 4), "spiking_so_far": int(spiked.sum())})
        log(f"  {split} {cond['name']}: readout {rate:.2f} Hz, {int(spiked.sum())} neurons have spiked")
    return spiked, rows


def cut(c: cx.Connectome, keep: np.ndarray) -> cx.Connectome:
    """The connectome restricted to ``keep`` (sorted original indices) and the synapses among them."""
    keep = np.sort(np.asarray(keep, dtype=np.int64))
    new = np.full(c.n, -1, dtype=np.int64)
    new[keep] = np.arange(keep.size)
    pre = c.pre_of_edges().astype(np.int64)
    post = np.asarray(c.indices, dtype=np.int64)
    inside = (new[pre] >= 0) & (new[post] >= 0)
    return cx.from_edges(
        np.asarray(c.root_ids)[keep],
        new[pre[inside]],
        new[post[inside]],
        np.asarray(c.syn_count)[inside],
        np.asarray(c.sign)[keep],
        manifest={"cut_from": c.manifest.get("name"), "kept": int(keep.size)},
    )


def circuit_json(red: cx.Connectome, inputs: np.ndarray, readout: np.ndarray, cfg: dict, source: dict, params: LIFParams) -> dict:
    """The circuit file: neurons, CSR wiring as signed synapse counts, its inputs and readout, and the LIF constants."""
    signed = (np.asarray(red.syn_count, dtype=np.int64) * np.asarray(red.sign, dtype=np.int64)[red.pre_of_edges()]).tolist()
    body = {
        "schema": CIRCUIT_SCHEMA,
        "id": cfg["id"],
        "source": source,
        "terms": "derived from FlyWire v783 (CC BY-NC 4.0; cite Dorkenwald et al. 2024 and Schlegel et al. 2024); model of Shiu et al. 2024",
        "lif": {
            "dt_ms": params.dt_ms,
            "v_0_mV": params.v_0_mV,
            "v_rst_mV": params.v_rst_mV,
            "v_th_mV": params.v_th_mV,
            "t_mbr_ms": params.t_mbr_ms,
            "tau_ms": params.tau_ms,
            "t_rfc_ms": params.t_rfc_ms,
            "t_dly_ms": params.t_dly_ms,
            "w_syn_mV": params.w_syn_mV,
            "f_poi": params.f_poi,
        },
        "neurons": int(red.n),
        "root_ids": [str(int(x)) for x in red.root_ids],
        "inputs": {"key": cfg["input"], "indices": [int(i) for i in inputs]},
        "readout": {"key": cfg["readout"], "indices": [int(i) for i in readout]},
        "indptr": [int(x) for x in red.indptr],
        "indices": [int(x) for x in red.indices],
        "signed_count": signed,
    }
    return body


def circuit_path(cfg: dict) -> Path:
    from .acquire import data_dir

    return data_dir() / "reduced" / f"{cfg['id']}.json"


def reduce(cfg_path: Path, compiled: Path, results: Path, log=print) -> dict:
    """Cut the circuit on the development regime, write it, and seal the record of the cut."""
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    watch = code_watch(results)
    c = cx.load(compiled)
    params = LIFParams()
    net = lif.Network(c, params)
    inputs, in_rep = resolve(cfg["input"], c)
    readout, out_rep = resolve(cfg["readout"], c)
    with Meter() as m:
        spiked, rows = spiking_set(net, inputs, readout, cfg["dev"], cfg, "dev", log=log)
    keep = np.flatnonzero(spiked | np.isin(np.arange(c.n), np.concatenate([inputs, readout])))
    red = cut(c, keep)
    new = np.full(c.n, -1, dtype=np.int64)
    new[keep] = np.arange(keep.size)
    source = {"connectome": compiled.name, "arrays_sha256": cx.arrays_digest(c), "neurons": c.n, "synapses": c.synapses}
    circ = circuit_json(red, new[inputs], new[readout], cfg, source, params)
    text = canonical(circ) + "\n"
    out = circuit_path(cfg)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8", newline="\n")
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    log(f"cut: {red.n} neurons, {red.pairs} pairs, {red.synapses} synapses -> {out} ({digest[:12]})")
    record = {
        "schema": RESULT_SCHEMA,
        "kind": "reduced-circuit",
        "id": cfg["id"],
        "config": cfg,
        "config_sha256": hashlib.sha256(cfg_path.read_bytes()).hexdigest(),
        "code": watch(),
        "environment": environment(),
        "machine": machine(),
        "source": source,
        "populations": {"input": in_rep, "readout": out_rep},
        "circuit": {
            "file": f"$FLY_NEURAL_DATA/reduced/{cfg['id']}.json (outside the repository: a connectivity table derived from FlyWire data)",
            "sha256": digest,
            "neurons": int(red.n),
            "pairs": int(red.pairs),
            "synapses": int(red.synapses),
            "excitatory_pairs": int((np.asarray(red.sign)[red.pre_of_edges()] > 0).sum()),
            "inhibitory_pairs": int((np.asarray(red.sign)[red.pre_of_edges()] < 0).sum()),
        },
        "dev": rows,
        "resources": m.describe(),
    }
    return sealed(record)


def _trial_pair(full: lif.Network, red: lif.Network, keep: np.ndarray, in_full: np.ndarray, in_red: np.ndarray, cond: dict, cfg: dict, seed) -> dict:
    t0 = time.perf_counter()
    tf, _ = lif.run(full, _stimulus(cond, in_full), cfg["duration_ms"], rng=np.random.default_rng(seed))
    t1 = time.perf_counter()
    tr, _ = lif.run(red, _stimulus(cond, in_red), cfg["duration_ms"], rng=np.random.default_rng(seed))
    t2 = time.perf_counter()
    outside = np.ones(full.n, dtype=bool)
    outside[keep] = False
    return {
        "exact": bool(np.array_equal(tf.counts[keep], tr.counts)),
        "mismatched_neurons": int((tf.counts[keep] != tr.counts).sum()),
        "closure_violations": int((tf.counts[outside] > 0).sum()),
        "full_counts": tf.counts,
        "red_counts": tr.counts,
        "full_s": t1 - t0,
        "red_s": t2 - t1,
    }


def check(cfg_path: Path, compiled: Path, results: Path, split: str, log=print) -> dict:
    """Run the whole brain and the cut side by side on a regime, with the same draws, and judge the criteria."""
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    if split not in ("dev", "heldout"):
        raise ValueError("split must be dev or heldout")
    watch = code_watch(results)
    path = circuit_path(cfg)
    text = path.read_text(encoding="utf-8")
    circ = json.loads(text)
    if circ.get("schema") != CIRCUIT_SCHEMA or circ.get("id") != cfg["id"]:
        raise ValueError(f"{path} is not this config's circuit")
    c = cx.load(compiled)
    if circ["source"]["arrays_sha256"] != cx.arrays_digest(c):
        raise ValueError("the circuit was cut from another connectome")
    params = LIFParams()
    full = lif.Network(c, params)
    keep = c.index_of(np.array([int(x) for x in circ["root_ids"]], dtype=np.int64))
    if not np.all(np.diff(keep) > 0):
        raise ValueError("the circuit's neurons are not in the connectome's order")
    red_c = cut(c, keep)
    if [int(x) for x in red_c.indptr] != circ["indptr"] or [int(x) for x in red_c.indices] != circ["indices"]:
        raise ValueError("the circuit file does not match a fresh cut of the connectome")
    red = lif.Network(red_c, params)
    in_full, _ = resolve(cfg["input"], c)
    ro_full, _ = resolve(cfg["readout"], c)
    in_red = np.asarray(circ["inputs"]["indices"], dtype=np.int64)
    ro_red = np.asarray(circ["readout"]["indices"], dtype=np.int64)
    conds = cfg["dev"] if split == "dev" else cfg["heldout"]
    rows = []
    full_s = red_s = 0.0
    with Meter() as m:
        for cond in conds:
            exact = 0
            closure = 0
            mism = 0
            closed = closed_exact = 0
            rf, rr = [], []
            for k in range(int(cfg["trials"])):
                seed = seed_of(int(cfg["seeds"][split]) + 1, cond["name"], k)
                r = _trial_pair(full, red, keep, in_full, in_red, cond, cfg, seed)
                exact += r["exact"]
                closure += r["closure_violations"]
                if r["closure_violations"] == 0:
                    closed += 1
                    closed_exact += r["exact"]
                mism += r["mismatched_neurons"]
                rf.append(int(r["full_counts"][ro_full].sum()))
                rr.append(int(r["red_counts"][ro_red].sum()))
                full_s += r["full_s"]
                red_s += r["red_s"]
            secs = cfg["duration_ms"] / 1000.0
            row = {
                "condition": cond["name"],
                "trials": int(cfg["trials"]),
                "exact_trials": exact,
                "mismatched_neuron_trials": mism,
                "closure_violations": closure,
                "closed_trials": closed,
                "closed_trials_exact": closed_exact,
                "readout_hz_full": round(float(np.mean(rf)) / ro_full.size / secs, 4),
                "readout_hz_reduced": round(float(np.mean(rr)) / ro_red.size / secs, 4),
            }
            rows.append(row)
            log(f"  {split} {cond['name']}: {exact}/{cfg['trials']} exact, {closure} closure violations, MN9 {row['readout_hz_full']} vs {row['readout_hz_reduced']} Hz")
    trials = sum(r["trials"] for r in rows)
    sim_s = trials * cfg["duration_ms"] / 1000.0
    speedup = full_s / red_s if red_s > 0 else None
    crit = cfg["criteria"]
    tol = cfg["readout_tolerance"]
    worst = max(abs(r["readout_hz_reduced"] - r["readout_hz_full"]) - max(tol["relative"] * r["readout_hz_full"], tol["absolute_hz"]) for r in rows)
    exact_all = sum(r["exact_trials"] for r in rows)
    closed = sum(r["closed_trials"] for r in rows)
    closed_exact = sum(r["closed_trials_exact"] for r in rows)
    judged = {
        "R1": {"text": crit["R1"], "passed": worst <= 0, "value": f"largest excess over the tolerance {round(worst, 4)} Hz (<= 0 passes)"},
        "R2": {"text": crit["R2"], "passed": exact_all >= float(cfg["min_exact_share"]) * trials, "value": f"{exact_all}/{trials} trials exact"},
        "R3": {"text": crit["R3"], "passed": closed_exact == closed, "value": f"{closed_exact}/{closed} closed trials exact; {sum(r['closure_violations'] for r in rows)} closure violations in all"},
    }
    record = {
        "schema": RESULT_SCHEMA,
        "kind": "reduced-circuit-check",
        "id": cfg["id"],
        "split": split,
        "config_sha256": hashlib.sha256(cfg_path.read_bytes()).hexdigest(),
        "circuit_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "code": watch(),
        "environment": environment(),
        "machine": machine(),
        "conditions": rows,
        "cost": {
            "simulated_s": sim_s,
            "full_brain_wall_s_per_sim_s": round(full_s / sim_s, 4),
            "reduced_wall_s_per_sim_s": round(red_s / sim_s, 5),
            "speedup": None if speedup is None else round(speedup, 1),
        },
        "criteria": judged,
        "resources": m.describe(),
    }
    return sealed(record)


FIXTURE_SCHEMA = "connectome-lif-conformance/v1"


def synthetic(seed: int, n: int = 80, p_edge: float = 0.12, inputs: int = 8) -> cx.Connectome:
    """A random signed network (not a connectome), for engine conformance tests."""
    rng = np.random.default_rng(seed)
    pre, post = np.nonzero(rng.random((n, n)) < p_edge)
    keep = pre != post
    pre, post = pre[keep], post[keep]
    counts = rng.integers(1, 40, size=pre.size)
    sign = np.where(rng.random(n) < 0.8, 1, -1).astype(np.int8)
    sign[:inputs] = 1
    return cx.from_edges(np.arange(1, n + 1, dtype=np.int64), pre, post, counts, sign, manifest={"name": f"synthetic-{seed}"})


def conformance_fixture(seed: int = 20261107, steps_n: int = 3000, rate_hz: float = 150.0) -> dict:
    """A synthetic network driven by deterministic kicks, and every spike lif.py gives it.

    The TypeScript engine (src/bethesda/ecology/connectome/lif.ts) replays the
    kicks and must give the same spikes, step for step."""
    c = synthetic(seed)
    params = LIFParams()
    net = lif.Network(c, params)
    inputs = np.arange(8, dtype=np.int64)
    rng = np.random.default_rng(seed + 1)
    kicks = {}
    for s in range(steps_n):
        hit = inputs[rng.random(inputs.size) < rate_hz * params.dt_ms * 1e-3]
        if hit.size:
            kicks[s] = hit
    t, _ = lif.run(net, lif.Stimulus(kicks=kicks), steps_n * params.dt_ms, max_logged_spikes=10**7)
    readout = np.array([c.n - 2, c.n - 1], dtype=np.int64)
    circ = circuit_json(c, inputs, readout, {"id": f"synthetic-{seed}", "input": "kicked", "readout": "last two"}, {"connectome": f"synthetic-{seed}", "note": "random, not a connectome"}, params)
    circ["terms"] = "synthetic: a random network made by fly_neural.reduce.synthetic, not derived from any connectome"
    return {
        "schema": FIXTURE_SCHEMA,
        "circuit": circ,
        "steps": steps_n,
        "kicks": [[int(s), [int(i) for i in v]] for s, v in sorted(kicks.items())],
        "spikes": [[int(a), int(b)] for a, b in t.spikes_logged],
        "counts": [int(x) for x in t.counts],
    }
