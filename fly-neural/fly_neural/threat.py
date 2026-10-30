"""Threat discrimination: ``experiments/threat-v783.json``.

The merged shadow replay of ``looms`` found the model's giant fiber (DNp01)
firing 194 times when ECHO did not escape, mostly to small, distant objects.
This module asks whether a looming-selective sensory mapping and a stateful
readout tell threats from harmless motion, on batteries of stimuli whose
ground truth comes from their own kinematics:

1. ``battery`` turns the config's stimuli into a timeline of the arena's
   looming stimuli (``src/bethesda/fly/arena.ts``'s ``LoomSpec``: straight
   segments at constant speed) and their ground truth: a threat reaches the
   fly (its surface within ``collision_margin_m``), a harmless stimulus never
   comes within ``harmless_min_surface_m``.
2. ``scripts/echo-threat-battery.ts`` shows the battery to a held research
   subject (a new fly built from a seed, kept perched) and records what it
   senses each 10 ms and ECHO's own escape decisions.
3. ``replay`` drives the connectome through a mapping (``v1``, as merged, or
   the looming-selective ``v2``), and keeps the giant fiber's spikes per
   sample.
4. Readouts, heuristics and ECHO are scored against the ground truth by the
   config's event rule; the development battery selects and freezes a
   mapping and readout, and the held-out battery judges it once.

Nothing a readout sees carries the ground truth: the observation is the
fly's own sensed angular size, expansion and bearing (``sensory.observation``
refuses anything else). The stimulus's contrast is taken from its battery
entry, because the fly's simulated eye has no contrast channel; ECHO's proxy
is contrast-blind.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from pathlib import Path

import numpy as np

from . import RESULT_SCHEMA, lif
from . import connectome as cx
from . import populations as P
from .record import code_watch, environment, load_sealed, sealed, write_json
from .resources import Meter, machine
from .sensory import Mapper, observation
from .shadow import read_recording

SCHEMA = "fly-neural-threat/v1"
BATTERY_SCHEMA = "fly-neural-threat-battery/v1"


def _cfg(path: Path) -> tuple[dict, str]:
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    if cfg.get("schema") != SCHEMA:
        raise ValueError(f"{path} is not a {SCHEMA} file")
    return cfg, hashlib.sha256(Path(path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


# --- the battery -------------------------------------------------------------------------


def direction(az_deg: float, el_deg: float) -> np.ndarray:
    """World direction at azimuth (+ to the fly's left) and elevation, for a fly at yaw 0
    (forward +x, left -z: units.ts ``forward``/``left``)."""
    a, e = math.radians(az_deg), math.radians(el_deg)
    return np.array([math.cos(e) * math.cos(a), math.sin(e), -math.cos(e) * math.sin(a)])


def _perp(az_deg: float) -> np.ndarray:
    a = math.radians(az_deg)
    return np.array([math.sin(a), 0.0, math.cos(a)])


def segments(s: dict, p: np.ndarray) -> list[tuple[np.ndarray, np.ndarray, float]]:
    """A stimulus as straight constant-speed segments (from, to, speed)."""
    d = direction(s["azimuth_deg"], s["elevation_deg"])
    r = s["radius"]
    end = p + max(0.0, r - 0.005) * d  # on the line of approach, its surface 5 mm into the fly
    k = s["kind"]
    if k == "approach":
        return [(p + s["distance"] * d, end, s["speed"])]
    if k == "accelerating":
        a, m = p + s["distance"] * d, p + 0.5 * s["distance"] * d
        return [(a, m, s["speed"]), (m, end, s["speed2"])]
    if k == "recede":
        return [(p + (r + 0.08) * d, p + s["distance"] * d, s["speed"])]
    if k == "stationary":
        a = p + s["distance"] * d
        return [(a, a + np.array([0.001, 0.0, 0.0]), 0.001 / s["duration_s"])]
    if k == "approach_stop":
        a, stop = p + s["distance"] * d, p + (r + s["stop_surface"]) * d
        return [(a, stop, s["speed"]), (stop, stop + np.array([0.001, 0.0, 0.0]), 0.001 / s["hold_s"])]
    q = _perp(s["azimuth_deg"])
    closest = p + s["miss"] * d
    if k == "lateral":
        L = s["half_length"]
        return [(closest - L * q, closest + L * q, s["speed"])]
    if k == "zigzag":
        L = s["half_length"]
        return [(closest - L * q, closest + 0.5 * L * q, s["speed"]), (closest + 0.5 * L * q, closest - 0.5 * L * q, s["speed"])]
    if k == "near_miss":
        off = s["miss"] * q
        return [(p + s["distance"] * d + off, p - 0.3 * d + off, s["speed"])]
    raise ValueError(f"unknown stimulus kind {k!r}")


def battery(cfg: dict, split: str) -> dict:
    """The split's timeline: the arena's looming specs, and each stimulus's window and ground truth."""
    p = np.array(cfg["fly"]["position"], dtype=float)
    tl, gt = cfg["timeline"], cfg["ground_truth"]
    t = tl["first_s"]
    looms, stimuli = [], []
    for i, s in enumerate(cfg["batteries"][split]["stimuli"]):
        t_on = t
        segs = []
        for a, b, v in segments(s, p):
            dur = float(np.linalg.norm(b - a)) / v
            looms.append({"start": round(t, 6), "period": 0, "count": 1, "from": [round(float(x), 6) for x in a], "to": [round(float(x), 6) for x in b], "speedMS": v, "radiusM": s["radius"], "stimulus": i})
            segs.append((t, a, b, dur))
            t += dur
        t_off = t
        # Ground truth from the kinematics, on a 1 ms grid.
        ts = np.arange(t_on, t_off + 1e-9, 0.001)
        cen = np.stack([_at(segs, x) for x in ts])
        surf = np.linalg.norm(cen - p, axis=1) - s["radius"]
        hit = np.flatnonzero(surf <= gt["collision_margin_m"])
        threat = bool(hit.size)
        if not threat and surf.min() < gt["harmless_min_surface_m"]:
            raise ValueError(f"stimulus {i} ({s['kind']}) is neither a threat nor harmless: closest surface {surf.min():.3f} m")
        stimuli.append({"index": i, **s, "t_on": round(t_on, 6), "t_off": round(t_off, 6), "threat": threat, "t_collision": round(float(ts[hit[0]]), 6) if threat else None, "min_surface_m": round(float(surf.min()), 6)})
        t += tl["gap_s"]
    duration = t - tl["gap_s"] + tl["tail_s"]
    body = {"schema": BATTERY_SCHEMA, "split": split, "fly": cfg["fly"], "sample_s": tl["sample_s"], "duration_s": round(duration, 6), "looms": looms, "stimuli": stimuli}
    return {**body, "sha256": hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}


def _at(segs, t: float) -> np.ndarray:
    """Where a stimulus's centre is at ``t``, as arena.ts ``loomAt`` moves it along its segments."""
    for k, (t0, a, b, dur) in enumerate(segs):
        if t <= t0 + dur or k == len(segs) - 1:
            u = 0.0 if dur <= 0 else min(1.0, max(0.0, (t - t0) / dur))
            return a + (b - a) * u
    raise AssertionError("unreachable")


def contrast_at(bat: dict, t: float) -> float:
    for s in bat["stimuli"]:
        if s["t_on"] - 1e-9 <= t <= s["t_off"] + 1e-9:
            return float(s["contrast"])
    return 1.0


# --- mappings and the replay -----------------------------------------------------------------


def v2_rates(base: Mapper, obs: dict, contrast: float, size50: float, width: float, exp_ref: float) -> dict[str, float]:
    r = base.rates(obs)
    for k in ("lplc2_left", "lplc2_right", "lc4_left", "lc4_right"):
        r[k] = 0.0
    loom = obs["looming"]
    if loom is not None and loom["expansionDegS"] > 0:
        side = "left" if loom["bearing"] > 0 else "right"
        sig = 1.0 / (1.0 + math.exp(-(loom["sizeDeg"] - size50) / width))
        r[f"lplc2_{side}"] = 200.0 * contrast * sig * min(1.0, loom["expansionDegS"] / exp_ref)
        r[f"lc4_{side}"] = 200.0 * contrast * min(1.0, loom["expansionDegS"] / 400.0)
    return r


def samples(recs: list[dict], sample_s: float) -> list[dict]:
    """One row per 10 ms sample: the last observation in it, and whether ECHO commanded an escape in it."""
    out: dict[int, dict] = {}
    for r in recs:
        k = int(round(r["t"] / sample_s))
        row = out.setdefault(k, {"t": k * sample_s, "obs": r["obs"], "echo_escape": False})
        row["obs"] = r["obs"]
        row["echo_escape"] = row["echo_escape"] or bool((r.get("echo") or {}).get("escape"))
    return [out[k] for k in sorted(out)]


def replay(rows: list[dict], bat: dict, mapping: str, cfg: dict, c, net, mapper: Mapper, dn_idx: np.ndarray, seed: int, log=print) -> dict:
    gf_idx = np.concatenate([mapper.idx["giant_fiber_left"], mapper.idx["giant_fiber_right"]])
    state = lif.State(net, np.random.default_rng(np.random.SeedSequence([seed, 31])))
    dt = net.params.dt_ms
    v2 = cfg["mappings"]["v2"]
    gf, dn, spikes = [], [], 0
    t0 = rows[0]["t"]
    w0 = time.monotonic()
    for i, r in enumerate(rows):
        obs = observation(r["obs"])
        if mapping == "v1":
            rates = mapper.rates(obs)
        else:
            rates = v2_rates(mapper, obs, contrast_at(bat, r["t"]), float(mapping.split("@")[1]), v2["constants"]["width_deg"], v2["constants"]["expansion_ref_deg_s"])
        stim = lif.Stimulus(poisson=[lif.Poisson(mapper.idx[k], rate, label=k) for k, rate in rates.items() if mapper.idx[k].size])
        end_ms = (r["t"] - t0 + bat["sample_s"]) * 1000.0
        tr, state = lif.run(net, stim, end_ms, state=state)
        gf.append(int(tr.counts[gf_idx].sum()))
        dn.append(int(tr.counts[dn_idx].sum()) if dn_idx.size else 0)
        spikes += int(tr.total_spikes)
        if i and i % 2000 == 0:
            log(f"    {mapping} seed {seed}: {i}/{len(rows)} samples, {time.monotonic() - w0:.0f} s")
    return {"gf": gf, "dn": dn, "total_spikes": spikes, "wall_s": round(time.monotonic() - w0, 2)}


# --- readouts, heuristics and scoring ---------------------------------------------------------


def readout_any(gf: list[int]) -> np.ndarray:
    return np.asarray(gf) > 0


def readout_integrated(gf: list[int], k: float, tau_ms: float, refractory_s: float, sample_s: float) -> np.ndarray:
    lam = math.exp(-sample_s * 1000.0 / tau_ms)
    out = np.zeros(len(gf), dtype=bool)
    level, quiet_until = 0.0, -1
    ref = int(round(refractory_s / sample_s))
    for i, s in enumerate(gf):
        level = level * lam + s
        if i >= quiet_until and level >= k:
            out[i] = True
            quiet_until = i + ref
            level = 0.0
    return out


def heuristic(rows: list[dict], kind: str, threshold: float) -> np.ndarray:
    out = np.zeros(len(rows), dtype=bool)
    for i, r in enumerate(rows):
        lo = r["obs"].get("looming")
        if not lo or lo["expansionDegS"] <= 0:
            continue
        if kind == "size":
            out[i] = lo["sizeDeg"] >= threshold
        elif kind == "ttc":
            out[i] = lo["sizeDeg"] >= 5.0 and lo["sizeDeg"] / lo["expansionDegS"] <= threshold
    return out


def onsets(flags: np.ndarray, ts: np.ndarray, merge_s: float) -> list[float]:
    out, last = [], -1e9
    for f, t in zip(flags, ts):
        if f:
            if t - last >= merge_s:
                out.append(float(t))
            last = t
    return out


def score(decisions: list[float], bat: dict, rows: list[dict], merge_s: float) -> dict:
    vis = {}
    for r in rows:
        if r["obs"].get("looming"):
            for s in bat["stimuli"]:
                if s["t_on"] - 1e-9 <= r["t"] <= s["t_off"] + 1e-9:
                    vis.setdefault(s["index"], r["t"])
    used, hits, leads, per = set(), 0, [], []
    threats = [s for s in bat["stimuli"] if s["threat"]]
    for s in threats:
        lo = vis.get(s["index"], s["t_on"])
        d = [k for k, t in enumerate(decisions) if k not in used and lo - 1e-9 <= t <= s["t_collision"] + 1e-9]
        if d:
            used.add(d[0])
            hits += 1
            leads.append(round(s["t_collision"] - decisions[d[0]], 4))
            per.append({"index": s["index"], "kind": s["kind"], "threat": True, "escaped": True, "lead_s": leads[-1], "latency_from_visible_s": round(decisions[d[0]] - lo, 4)})
        else:
            per.append({"index": s["index"], "kind": s["kind"], "threat": True, "escaped": False})
    fa = [t for k, t in enumerate(decisions) if k not in used]
    for s in bat["stimuli"]:
        if not s["threat"]:
            n = sum(1 for t in fa if s["t_on"] - 1e-9 <= t <= s["t_off"] + merge_s)
            per.append({"index": s["index"], "kind": s["kind"], "threat": False, "escaped": n > 0, "false_alarms": n})
    minutes = bat["duration_s"] / 60.0
    prec = hits / (hits + len(fa)) if hits + len(fa) else None
    rec = hits / len(threats) if threats else None
    f1 = 2 * prec * rec / (prec + rec) if prec and rec else 0.0
    return {
        "threats": len(threats),
        "harmless": len(bat["stimuli"]) - len(threats),
        "decisions": len(decisions),
        "hits": hits,
        "misses": len(threats) - hits,
        "false_alarms": len(fa),
        "false_alarms_per_min": round(len(fa) / minutes, 4),
        "false_alarms_with_nothing_showing": sum(1 for t in fa if not any(s["t_on"] - 1e-9 <= t <= s["t_off"] + merge_s for s in bat["stimuli"])),
        "precision": prec,
        "recall": rec,
        "f1": round(f1, 6),
        "median_lead_s": float(np.median(leads)) if leads else None,
        "min_lead_s": float(min(leads)) if leads else None,
        "median_latency_from_visible_s": float(np.median([x["latency_from_visible_s"] for x in per if x.get("escaped") and x["threat"]])) if leads else None,
        "per_stimulus": sorted(per, key=lambda x: x["index"]),
    }


def _mean_metrics(per_seed: list[dict]) -> dict:
    keys = ("recall", "precision", "f1", "false_alarms_per_min", "median_lead_s", "misses", "false_alarms")
    out = {}
    for k in keys:
        v = [m[k] for m in per_seed if m[k] is not None]
        out[k] = float(np.mean(v)) if v else None
    return out


def candidates(cfg: dict) -> list[dict]:
    out = []
    maps = ["v1"] + [f"v2@{s:g}" for s in cfg["mappings"]["v2"]["candidates"]["size50_deg"]]
    integ = cfg["readouts"]["integrated"]
    for m in maps:
        out.append({"name": f"{m}/any", "mapping": m, "readout": "any"})
        for k in integ["grid"]["k"]:
            for tau in integ["grid"]["tau_ms"]:
                out.append({"name": f"{m}/int-k{k}-tau{tau}", "mapping": m, "readout": "integrated", "k": k, "tau_ms": tau})
    return out


def decide(cand: dict, trace: dict, cfg: dict, sample_s: float) -> np.ndarray:
    if cand["readout"] == "any":
        return readout_any(trace["gf"])
    return readout_integrated(trace["gf"], cand["k"], cand["tau_ms"], cfg["readouts"]["integrated"]["refractory_s"], sample_s)


def _pick(scored: list[tuple[dict, dict]]) -> tuple[dict, dict, bool]:
    ok = [x for x in scored if (x[1]["recall"] or 0) >= 0.8]
    pool = ok or scored
    best = max(pool, key=lambda x: (x[1]["f1"] or 0.0, x[1]["median_lead_s"] if x[1]["median_lead_s"] is not None else -1e9, -scored.index(x)))
    return best[0], best[1], bool(ok)


# --- the run -----------------------------------------------------------------------------------


def work_dir(work: Path) -> Path:
    return work / "threat"


def write_battery(cfg_path: Path, split: str, work: Path) -> Path:
    cfg, _ = _cfg(cfg_path)
    bat = battery(cfg, split)
    out = work_dir(work) / f"battery-{split}.json"
    write_json(out, bat)
    return out


def run(cfg_path: Path, split: str, compiled: Path, work: Path, out_dir: Path, resume: bool = False, log=print) -> dict:
    code = code_watch(out_dir)
    cfg, config_sha256 = _cfg(cfg_path)
    bat = battery(cfg, split)
    on_disk = json.loads((work_dir(work) / f"battery-{split}.json").read_text(encoding="utf-8"))
    if on_disk.get("sha256") != bat["sha256"]:
        raise RuntimeError("the battery file differs from the config's; write it again with `threat battery`")
    rec_path = work_dir(work) / f"recording-{split}.jsonl"
    head, recs = read_recording(rec_path)
    if head.get("battery_sha256") != bat["sha256"] or not head.get("held"):
        raise RuntimeError(f"{rec_path.name} is not a held recording of this battery")
    rows = samples(recs, bat["sample_s"])
    ts = np.array([r["t"] for r in rows])
    merge = cfg["scoring"]["merge_s"]
    seeds = cfg["seeds"][split]
    if split == "dev":
        maps = ["v1"] + [f"v2@{s:g}" for s in cfg["mappings"]["v2"]["candidates"]["size50_deg"]]
        frozen = None
    else:
        frozen = load_sealed(out_dir / f"{cfg['id']}-dev.json", RESULT_SCHEMA)
        if frozen["config_sha256"] != config_sha256:
            raise RuntimeError("the development selection was made with another version of the config")
        maps = sorted({"v1", frozen["selected"]["mapping"]})
    c = cx.load(compiled)
    net = lif.Network(c)
    mapper = Mapper(c)
    dn_idx = np.sort(np.concatenate([P.select_ids_in(c, {"cell_type": [t]}) for t in ("DNp02", "DNp04", "DNp11")]))
    traces = {}
    with Meter() as meter:
        for m in maps:
            for seed in seeds:
                key = f"{split}-{m.replace('@', '-')}-{seed}"
                path = work_dir(work) / "traces" / f"{key}.json"
                ident = {"config_sha256": config_sha256, "battery_sha256": bat["sha256"], "recording_sha256": hashlib.sha256(rec_path.read_bytes()).hexdigest(), "commit": code.start.get("commit"), "dirty": code.start.get("dirty"), "fly_neural": code.start.get("fly_neural")}
                if resume and path.exists():
                    old = json.loads(path.read_text(encoding="utf-8"))
                    if old.get("ident") == ident:
                        traces[(m, seed)] = {**old["trace"], "resumed": True}
                        log(f"  {key}: resumed")
                        continue
                log(f"  replaying {key} ({len(rows)} samples)")
                tr = replay(rows, bat, m, cfg, c, net, mapper, dn_idx, seed, log)
                write_json(path, {"ident": ident, "trace": tr})
                traces[(m, seed)] = tr
    # Heuristics and ECHO: deterministic given the recording.
    heur = {}
    for kind, spec in cfg["heuristics"].items():
        if kind == "echo":
            continue
        grid = spec.get("grid_deg") or spec.get("grid_s")
        if split == "dev":
            scored = [({"threshold": th}, score(onsets(heuristic(rows, kind, th), ts, merge), bat, rows, merge)) for th in grid]
            choice, m, _ = _pick(scored)
            heur[kind] = {"threshold": choice["threshold"], "metrics": m, "grid": [{"threshold": a["threshold"], "f1": b["f1"], "recall": b["recall"], "fa_per_min": b["false_alarms_per_min"]} for a, b in scored]}
        else:
            th = frozen["heuristics"][kind]["threshold"]
            heur[kind] = {"threshold": th, "metrics": score(onsets(heuristic(rows, kind, th), ts, merge), bat, rows, merge)}
    echo = score(onsets(np.array([r["echo_escape"] for r in rows]), ts, merge), bat, rows, merge)
    cands = candidates(cfg) if split == "dev" else [x for x in candidates(cfg) if x["name"] in ("v1/any", frozen["selected"]["name"])]
    results = []
    for cand in cands:
        per = [score(onsets(decide(cand, traces[(cand["mapping"], s)], cfg, bat["sample_s"]), ts, merge), bat, rows, merge) for s in seeds]
        results.append((cand, {**_mean_metrics(per), "per_seed": per}))
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "threat",
        "experiment": cfg["id"],
        "config_file": Path(cfg_path).name,
        "config_sha256": config_sha256,
        "split": split,
        "battery": {"sha256": bat["sha256"], "stimuli": len(bat["stimuli"]), "threats": sum(s["threat"] for s in bat["stimuli"]), "duration_s": bat["duration_s"], "kinds": sorted({s["kind"] for s in bat["stimuli"]})},
        "recording": {"file": rec_path.name, "sha256": hashlib.sha256(rec_path.read_bytes()).hexdigest(), "header": head, "samples": len(rows)},
        "connectome": {"path_name": Path(compiled).name, "manifest_sha256": c.manifest.get("sha256")},
        "seeds": seeds,
        "replays": {f"{m}/{s}": {k: v for k, v in tr.items() if k not in ("gf", "dn")} | {"gf_spikes": int(sum(tr["gf"])), "dn_spikes": int(sum(tr["dn"]))} for (m, s), tr in traces.items()},
        "candidates": [{"candidate": cand, "metrics": {k: v for k, v in mm.items() if k != "per_seed"}, **({"per_seed": mm["per_seed"]} if split == "heldout" or cand["name"] == "v1/any" else {})} for cand, mm in results],
        "heuristics": heur,
        "echo": echo,
    }
    if split == "dev":
        sel, sel_m, met = _pick([(cand, mm) for cand, mm in results])
        body["selected"] = {**sel, "metrics": {k: v for k, v in sel_m.items() if k != "per_seed"}, "per_seed": sel_m["per_seed"], "met_recall_floor": met}
    else:
        sel = frozen["selected"]
        body["selected"] = {"name": sel["name"], "from": f"{cfg['id']}-dev.json", "from_sha256": frozen["sha256"]}
        by = {cand["name"]: mm for cand, mm in results}
        body["criteria"] = judge(cfg, by[sel["name"]], by["v1/any"], heur, echo)
        body["failed"] = [v["id"] for v in body["criteria"] if not v["passed"]]
    body |= {"resources": {**meter.describe(), "machine": machine()}, "environment": environment(), "code": code()}
    data = sealed(body)
    write_json(out_dir / f"{cfg['id']}-{split}.json", data)
    log(f"wrote {out_dir / (cfg['id'] + '-' + split + '.json')}" + (f"; selected {body['selected']['name']}" if split == "dev" else f"; failed {body['failed']}"))
    return data


def judge(cfg: dict, sel: dict, base: dict, heur: dict, echo: dict) -> list[dict]:
    out = []
    for cr in cfg["criteria"]:
        v = {"id": cr["id"], "claim": cr["claim"], "test": cr["test"]}
        t = cr["test"]
        if t == "baseline_fa":
            v.update(value=base["false_alarms_per_min"], passed=base["false_alarms_per_min"] >= cr["min_fa_per_min"])
        elif t == "fa_reduction":
            ratio = sel["false_alarms_per_min"] / base["false_alarms_per_min"] if base["false_alarms_per_min"] else None
            v.update(selected=sel["false_alarms_per_min"], merged=base["false_alarms_per_min"], ratio=ratio, passed=ratio is not None and ratio <= cr["max_ratio"])
        elif t == "recall_kept":
            v.update(selected=sel["recall"], merged=base["recall"], passed=sel["recall"] is not None and sel["recall"] >= cr["min_recall"] and sel["recall"] >= base["recall"] - cr["max_drop"])
        elif t == "lead_time":
            v.update(value=sel["median_lead_s"], passed=sel["median_lead_s"] is not None and sel["median_lead_s"] >= cr["min_median_lead_s"])
        elif t == "f1_at_least":
            others = {b: (echo if b == "echo" else heur[b]["metrics"])["f1"] for b in cr["b"]}
            v.update(selected=sel["f1"], others=others, passed=all(sel["f1"] >= x for x in others.values()))
        elif t == "report_only":
            v.update(passed=True, note="exploratory: see per_stimulus in each candidate's per_seed")
        out.append(v)
    return out
