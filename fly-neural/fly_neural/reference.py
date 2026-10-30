"""The full-brain comparison with Brian 2 of ``experiments/brian2-reference.json``.

The Brian 2 run (``reference/shiu_brian2.py trials``) is read from its file;
this engine runs the same stimulus on its own seeds; the criteria are judged
on per-trial MN9 rates and per-neuron mean rates. The two share the model,
not the random stream, so the comparison is statistical.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np

from . import RESULT_SCHEMA, lif, stats
from . import connectome as cx
from . import populations as P
from .record import code_watch, environment, sealed, write_json
from .resources import Meter, machine

SCHEMA = "fly-neural-reference/v1"
MN9 = 720575940660219265


# What must match between Brian 2 runs whose trials are pooled.
SAME_SETUP = ("exc", "exc2", "silence", "rate", "rate2")


def read_brian2(paths: list[Path]) -> dict:
    """One or more Brian 2 trial files of the same setup, pooled; each is read as written.

    A run stopped part way keeps the trials it finished (they are written one
    at a time), and the rest can be run with their own seeds; pooling checks
    that every file ran the same stimulus, model file and population, and
    that no seed repeats."""
    runs = []
    for p in paths:
        d = json.loads(Path(p).read_text(encoding="utf-8"))
        if d.get("schema") != "fly-neural-brian2-trials/v1":
            raise ValueError(f"{p} is not a Brian 2 trials file")
        runs.append((Path(p), d))
    first = runs[0][1]
    for p, d in runs[1:]:
        for k in SAME_SETUP:
            if d["args"].get(k) != first["args"].get(k):
                raise ValueError(f"{p.name}: {k} differs from {runs[0][0].name}")
        for k in ("missing_ids", "neurons", "t_run_ms"):
            if d.get(k) != first.get(k):
                raise ValueError(f"{p.name}: {k} differs from {runs[0][0].name}")
        if d["environment"].get("shiu_model_py_sha256") != first["environment"].get("shiu_model_py_sha256"):
            raise ValueError(f"{p.name}: a different model.py")
    trials = [tr for _, d in runs for tr in d["trials"]]
    seeds = [tr["brian2_seed"] for tr in trials]
    if len(set(seeds)) != len(seeds):
        raise ValueError("a Brian 2 seed repeats across the files")
    return {
        **first,
        "trials": sorted(trials, key=lambda tr: tr["brian2_seed"]),
        "files": [
            {
                "file": p.name,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                "trials": len(d["trials"]),
                "seeds": [tr["brian2_seed"] for tr in d["trials"]],
                "requested_trials": d["args"].get("trials"),
                "total_wall_s": d.get("total_wall_s"),
                "environment": d.get("environment"),
            }
            for p, d in runs
        ],
    }


def run(cfg_path: Path, brian2_paths: list[Path], compiled: Path, out_dir: Path, log=print) -> dict:
    code = code_watch(out_dir)
    cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    if cfg.get("schema") != SCHEMA:
        raise ValueError(f"{cfg_path} is not a {SCHEMA} file")
    b2 = read_brian2([Path(x) for x in brian2_paths])
    eng = cfg["engine"]
    c = cx.load(compiled)
    net = lif.Network(c)
    idx, pop = P.resolve(eng["population"], c)
    stim_ids = {int(x) for x in np.asarray(c.root_ids)[idx]}
    secs = eng["duration_ms"] / 1000.0
    total = np.zeros(c.n, dtype=np.int64)
    mn9_ours = []
    mn9_i = int(c.index_of([MN9])[0])
    with Meter() as meter:
        for k in range(eng["trials"]):
            t, _ = lif.run(net, lif.Stimulus(poisson=[lif.Poisson(idx, eng["rate_hz"])]), eng["duration_ms"], rng=np.random.default_rng(np.random.SeedSequence([eng["seed"], k])))
            total += t.counts
            mn9_ours.append(int(t.counts[mn9_i]) / secs)
    ours = {int(c.root_ids[i]): total[i] / eng["trials"] / secs for i in np.flatnonzero(total)}
    n_b2 = len(b2["trials"])
    b2_total: dict[int, int] = {}
    for tr in b2["trials"]:
        for k, v in tr["counts"].items():
            b2_total[int(k)] = b2_total.get(int(k), 0) + v
    b2_secs = b2["t_run_ms"] / 1000.0
    theirs = {k: v / n_b2 / b2_secs for k, v in b2_total.items()}
    mn9_b2 = [tr["counts"].get(str(MN9), 0) / b2_secs for tr in b2["trials"]]

    verdicts = []
    for crit in cfg["criteria"]:
        out = {"id": crit["id"], "claim": crit["claim"], "test": crit["test"], "threshold_note": crit.get("threshold_note")}
        if crit["test"] == "mn9_same":
            a, b = np.array(mn9_ours), np.array(mn9_b2)
            mw = stats.mann_whitney(a, b, "two-sided")
            se = math.sqrt(a.var(ddof=1) / a.size + b.var(ddof=1) / b.size)
            diff = float(a.mean() - b.mean())
            out.update(ours=stats.summary(a), brian2=stats.summary(b), difference_hz=diff, se_difference_hz=se, mann_whitney=mw)
            out["passed"] = bool(mw["p"] >= crit["alpha"] and abs(diff) <= 3 * se)
        elif crit["test"] == "rate_correlation":
            keys = sorted((set(ours) | set(theirs)) - stim_ids)
            x = [ours.get(k, 0.0) for k in keys]
            y = [theirs.get(k, 0.0) for k in keys]
            r = stats.pearson(x, y)
            out.update(neurons=len(keys), pearson_r=r, passed=r is not None and r >= crit["min_r"])
        elif crit["test"] == "responder_jaccard":
            A = {k for k, v in ours.items() if v >= crit["min_hz"]} - stim_ids
            B = {k for k, v in theirs.items() if v >= crit["min_hz"]} - stim_ids
            j = len(A & B) / len(A | B) if A | B else None
            out.update(ours=len(A), brian2=len(B), both=len(A & B), jaccard=j, only_ours=sorted(str(x) for x in A - B)[:50], only_brian2=sorted(str(x) for x in B - A)[:50])
            out["passed"] = j is not None and j >= crit["min_jaccard"]
        verdicts.append(out)
        log(f"  {out['id']}: {'pass' if out['passed'] else 'FAIL'}")
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "reference",
        "experiment": cfg["id"],
        "config_file": Path(cfg_path).name,
        "config_sha256": hashlib.sha256(Path(cfg_path).read_bytes().replace(b"\r\n", b"\n")).hexdigest(),
        "brian2_run": {"files": b2["files"], "trials": n_b2, "wall_s_per_trial": stats.summary([tr["wall_s"] for tr in b2["trials"]]), "missing_ids": b2.get("missing_ids"), "seeds": [tr["brian2_seed"] for tr in b2["trials"]]},
        "engine_run": {"trials": eng["trials"], "seed": eng["seed"], "population": pop, "resources": meter.describe(), "wall_s_per_trial": round(meter.describe()["wall_s"] / eng["trials"], 3)},
        "connectome": {"path_name": Path(compiled).name, "manifest_sha256": c.manifest.get("sha256"), "sign_policy": c.manifest.get("sign_policy")},
        "criteria": verdicts,
        "failed": [v["id"] for v in verdicts if not v["passed"]],
        "machine": machine(),
        "environment": environment(),
        "code": code(),
    }
    data = sealed(body)
    write_json(out_dir / f"{cfg['id']}.json", data)
    log(f"wrote {out_dir / (cfg['id'] + '.json')}; failed {data['failed']}")
    return data
