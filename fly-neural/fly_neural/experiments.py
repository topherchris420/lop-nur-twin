"""Run a pre-registered experiment file (``fly-neural/experiments/*.json``) and judge its criteria.

The file fixes the conditions, trial counts, seed bases and pass criteria
before anything runs. A run names its seed split, ``dev`` or ``heldout``; the
seeds of trial ``k`` of a condition come from ``SeedSequence([base, crc32(name),
k])``, so adding or reordering conditions never changes another condition's
draws. Control wirings take their seed from the same sequence, so each trial of
a control condition runs on its own shuffle (as Shiu et al.'s 100 shuffled
simulations did).

A criterion is judged only from that run's own trials, and the result records
every number the verdict used. A failed criterion is reported as failed.
"""

from __future__ import annotations

import json
import os
import time
import zlib
from pathlib import Path

import numpy as np

from . import RESULT_SCHEMA, controls, lif, stats
from . import connectome as cx
from . import populations as P
from .record import code_watch, environment, sealed
from .resources import Budget, Meter, machine

EXPERIMENT_SCHEMA = "fly-neural-experiment/v1"


def load_config(path: Path) -> dict:
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    if cfg.get("schema") != EXPERIMENT_SCHEMA:
        raise ValueError(f"{path} is not a {EXPERIMENT_SCHEMA} file")
    names = [c["name"] for c in cfg["conditions"]]
    if len(set(names)) != len(names):
        raise ValueError("condition names repeat")
    for crit in cfg["criteria"]:
        for key in ("condition", "a", "b"):
            if key in crit and crit[key] not in names:
                raise ValueError(f"criterion {crit['id']} names unknown condition {crit[key]!r}")
        for name in crit.get("conditions", []):
            if name not in names:
                raise ValueError(f"criterion {crit['id']} names unknown condition {name!r}")
    return cfg


def seed_of(base: int, condition: str, trial: int) -> np.random.SeedSequence:
    return np.random.SeedSequence([base, zlib.crc32(condition.encode("utf-8")), trial])


def run_condition(c: cx.Connectome, net: lif.Network, cond: dict, cfg: dict, split: str, readouts: dict, budget: Budget | None, log=print) -> dict:
    proto = cfg["protocol"]
    trials = int(cond.get("trials", proto["trials"]))
    base = int(cfg["seeds"][split])
    stim_idx = {k: P.resolve(k, c)[0] for k in cond["stimulate"]}
    poisson = [lif.Poisson(stim_idx[k], float(r), label=k) for k, r in cond["stimulate"].items()]
    silenced = np.unique(np.concatenate([P.resolve(k, c)[0] for k in cond.get("silence", [])] or [np.zeros(0, dtype=np.int64)]))
    stim = lif.Stimulus(poisson=poisson, silenced=silenced)
    driven = np.unique(np.concatenate(list(stim_idx.values())))
    per_trial = {k: [] for k in readouts}
    total = np.zeros(c.n, dtype=np.int64)
    spikes, wiring_stats = [], []
    with Meter() as meter:
        for k in range(trials):
            ss = seed_of(base, cond["name"], k)
            sim_seed, wiring_seed = ss.spawn(2)
            use = net
            if cond.get("wiring"):
                w, st = controls.wiring(c, cond["wiring"], int(wiring_seed.generate_state(1)[0]))
                use = lif.Network(c, net.params, wiring=w, label=cond["wiring"])
                wiring_stats.append(st)
            t, _ = lif.run(use, stim, proto["duration_ms"], rng=np.random.default_rng(sim_seed), budget=budget)
            total += t.counts
            spikes.append(t.total_spikes)
            for key, idx in readouts.items():
                per_trial[key].append(int(t.counts[idx].sum()) if idx.size else None)
    secs = proto["duration_ms"] / 1000.0
    mean_rate = total / trials / secs
    outside = np.ones(c.n, dtype=bool)
    outside[driven] = False
    active = np.flatnonzero(mean_rate > 0)
    out = {
        "name": cond["name"],
        "stimulate": cond["stimulate"],
        "silence": cond.get("silence", []),
        "wiring": cond.get("wiring", "connectome"),
        "trials": trials,
        "neurons_stimulated": int(driven.size),
        "neurons_silenced": int(silenced.size),
        "readout_spikes_per_trial": per_trial,
        "readout_summary_hz": {k: stats.summary(np.array(v) / secs) for k, v in per_trial.items() if None not in v},
        "responders_gt0": int(((mean_rate > 0) & outside).sum()),
        "responders_ge1hz": int(((mean_rate >= 1.0) & outside).sum()),
        "spikes_per_trial": stats.summary(spikes),
        "active_root_ids": [str(x) for x in np.asarray(c.root_ids)[active]],
        "active_mean_hz": [round(float(x), 4) for x in mean_rate[active]],
        "resources": meter.describe(),
    }
    if wiring_stats:
        out["wiring_stats"] = {k: stats.summary([w[k] for w in wiring_stats]) for k in ("autapses", "repeated_pairs", "inhibitory_pairs", "synapses")}
    log(f"  {cond['name']}: " + ", ".join(f"{k} {v['mean']:.1f} Hz" for k, v in out["readout_summary_hz"].items()) + f"; responders {out['responders_gt0']}; {meter.describe()['wall_s']:.1f} s")
    return out


def judge(crit: dict, res: dict[str, dict], secs: float) -> dict:
    t = crit["test"]

    def rates(name, readout):
        return np.array(res[name]["readout_spikes_per_trial"][readout], dtype=np.float64) / secs

    out = {"id": crit["id"], "claim": crit["claim"], "test": t}
    if t in ("fraction_active", "fraction_active_max"):
        r = rates(crit["condition"], crit["readout"])
        k, n = int((r > 0).sum()), int(r.size)
        out.update(active_trials=k, trials=n, fraction=k / n, wilson95=stats.wilson(k, n))
        out["passed"] = (k / n >= crit["min"]) if t == "fraction_active" else (k / n <= crit["max"])
    elif t in ("less", "greater"):
        a, b = rates(crit["a"], crit["readout"]), rates(crit["b"], crit["readout"])
        mw = stats.mann_whitney(a, b, t)
        out.update(a_mean_hz=float(a.mean()), b_mean_hz=float(b.mean()), mann_whitney=mw)
        ok = mw["p"] < crit["alpha"]
        if "ratio_max_b_over_a" in crit:
            ratio = float(b.mean() / a.mean()) if a.mean() > 0 else None
            out["ratio_b_over_a"] = ratio
            ok = ok and ratio is not None and ratio <= crit["ratio_max_b_over_a"]
        out["passed"] = bool(ok)
    elif t == "mean_at_least":
        r = rates(crit["condition"], crit["readout"])
        out.update(mean_hz=float(r.mean()), passed=bool(r.mean() >= crit["min_hz"]))
    elif t == "responders_increase":
        lo, hi = (res[n]["responders_gt0"] for n in crit["conditions"])
        out.update(responders=dict(zip(crit["conditions"], (lo, hi))), passed=bool(hi >= crit["factor"] * max(lo, 1)))
    elif t == "all_respond":
        means = {k: float(rates(crit["condition"], k).mean()) for k in crit["readouts"]}
        out.update(mean_hz=means, passed=all(v > 0 for v in means.values()))
    else:
        raise ValueError(f"unknown test {t!r}")
    return out


PROGRESS_SCHEMA = "fly-neural-progress/v1"


class ProgressMismatch(RuntimeError):
    pass


def _progress(path: Path | None, header: dict, resume: bool, log=print) -> dict[str, dict]:
    """Conditions an earlier process finished, if ``resume`` and the file is of this exact run.

    The file's first line is the run's identity: experiment, split, config
    hash, commit, cleanliness, this package's source digest and the
    connectome's manifest hash. Every condition has its own seeds, so a
    condition finished by an earlier process is the one this process would
    compute. Anything else in the file is refused, never mixed in."""
    if path is None or not resume or not path.exists():
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(header, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        return {}
    lines = path.read_text(encoding="utf-8").splitlines()
    old = json.loads(lines[0])
    if old != header:
        diff = sorted(k for k in set(old) | set(header) if old.get(k) != header.get(k))
        raise ProgressMismatch(f"{path} is from a different run ({', '.join(diff)} differ); remove it or run without --resume")
    done = {}
    for ln in lines[1:]:
        if ln.strip():
            r = json.loads(ln)
            done[r["name"]] = r
    log(f"resuming: {len(done)} conditions finished by an earlier process: {', '.join(done) or 'none'}")
    return done


def run(
    cfg_path: Path,
    split: str,
    compiled: Path,
    out_dir: Path,
    only: list[str] | None = None,
    budget: Budget | None = None,
    log=print,
    progress: Path | None = None,
    resume: bool = False,
) -> dict:
    code = code_watch(out_dir)
    cfg = load_config(cfg_path)
    if split not in cfg["seeds"]:
        raise ValueError(f"seed split must be one of {sorted(cfg['seeds'])}")
    c = cx.load(compiled)
    if c.manifest.get("sign_policy") != cfg["protocol"]["sign_policy"]:
        raise ValueError(f"{compiled} has sign policy {c.manifest.get('sign_policy')!r}; the protocol asks for {cfg['protocol']['sign_policy']!r}")
    net = lif.Network(c)
    keys = set(cfg["readouts"]) | {k for cond in cfg["conditions"] for k in [*cond["stimulate"], *cond.get("silence", [])]}
    pops = {k: P.resolve(k, c)[1] for k in sorted(keys)}
    readouts = {k: P.resolve(k, c)[0] for k in cfg["readouts"]}
    conds = [x for x in cfg["conditions"] if not only or x["name"] in only]
    config_sha256 = __import__("hashlib").sha256(Path(cfg_path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    start = code.start
    header = {
        "schema": PROGRESS_SCHEMA,
        "experiment": cfg["id"],
        "split": split,
        "only": sorted(only) if only else None,
        "config_sha256": config_sha256,
        "commit": start.get("commit"),
        "dirty": start.get("dirty"),
        "fly_neural": start.get("fly_neural"),
        "connectome_manifest_sha256": c.manifest.get("sha256"),
    }
    earlier = _progress(progress, header, resume, log)
    t0 = time.monotonic()
    results = {}
    with Meter() as meter:
        for cond in conds:
            if cond["name"] in earlier:
                results[cond["name"]] = earlier[cond["name"]]
                continue
            results[cond["name"]] = run_condition(c, net, cond, cfg, split, readouts, budget, log)
            if progress is not None:
                with open(progress, "a", encoding="utf-8", newline="\n") as f:
                    f.write(json.dumps(results[cond["name"]], sort_keys=True) + "\n")
                    f.flush()
                    os.fsync(f.fileno())
    secs = cfg["protocol"]["duration_ms"] / 1000.0
    verdicts = []
    for crit in cfg["criteria"]:
        needed = [crit[k] for k in ("condition", "a", "b") if k in crit] + crit.get("conditions", [])
        if all(n in results for n in needed):
            verdicts.append({**judge(crit, results, secs), "quote": crit.get("quote"), "threshold_note": crit.get("threshold_note")})
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "experiment",
        "experiment": cfg["id"],
        "config_file": Path(cfg_path).name,
        "config_sha256": config_sha256,
        "split": split,
        "partial": bool(only),
        # Conditions finished by an earlier process of this same run (same commit,
        # source, config and connectome; see _progress), carried over unchanged.
        "resumed_conditions": [n for n in results if n in earlier],
        "connectome": {"path_name": Path(compiled).name, "manifest_sha256": c.manifest.get("sha256"), "neurons": c.n, "pairs": c.pairs, "synapses": c.synapses, "sign_policy": c.manifest.get("sign_policy")},
        "network": net.describe(),
        "params": net.params.as_dict(),
        "populations": pops,
        "conditions": results,
        "criteria": verdicts,
        "passed": sum(v["passed"] for v in verdicts),
        "failed": [v["id"] for v in verdicts if not v["passed"]],
        "resources": {**meter.describe(), "machine": machine()},
        "wall_s": round(time.monotonic() - t0, 2),
        "wall_s_including_earlier_processes": round(time.monotonic() - t0 + sum(earlier[n]["resources"]["wall_s"] for n in results if n in earlier), 2),
        "environment": environment(),
        "code": code(),
    }
    data = sealed(body)
    from .record import write_json

    name = f"{cfg['id']}-{split}{'-partial' if only else ''}.json"
    write_json(out_dir / name, data)
    log(f"wrote {out_dir / name}: {data['passed']}/{len(verdicts)} criteria passed; failed {data['failed']}")
    return data
