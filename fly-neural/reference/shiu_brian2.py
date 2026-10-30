"""Run Shiu et al.'s own Brian 2 model, unmodified, as the reference for fly_neural.lif.

This script needs Brian 2, pandas and pyarrow (see requirements-reference.txt);
it does not need the rest of fly_neural. It imports ``model.py`` from the data
cache, at the pinned commit, after checking its SHA-256, and builds every
network with that file's own ``create_model``, ``silence`` and ``run_trial``.
Nothing from Shiu et al. is copied into this repository.

Commands:

- ``conformance --out FILE``: small synthetic networks driven by deterministic
  "kicks" (a SpikeGeneratorGroup adding ``w_syn * f_poi`` to ``v``, the jump a
  Poisson event gives, with the target's refractory period set to 0 as
  ``poi()`` does). Writes each case and the spike steps Brian 2 recorded; the
  test suite replays the cases in fly_neural.lif and requires the same spikes.
- ``trials --exc ID... --rate HZ --trials N --seed S --out FILE``: Shiu's
  ``run_trial`` on the full v783 network (their Completeness_783.csv and
  Connectivity_783.parquet), one trial at a time, with Brian 2 seeded per trial.
  Writes per-neuron spike counts, wall time and memory.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from fly_neural.acquire import path_of, verify  # noqa: E402  (stdlib-only modules)
from fly_neural.sources import BY_KEY  # noqa: E402


def load_shiu():
    from brian2 import prefs

    # Shiu et al. leave the target at "auto", which falls back to numpy without a
    # C++ compiler; pin it so every run records the target it used.
    prefs.codegen.target = "numpy"
    verify("shiu_model_py")
    p = path_of("shiu_model_py")
    spec = importlib.util.spec_from_file_location("shiu_model", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def env() -> dict:
    import brian2
    import numpy
    import pandas

    out = {
        "python": platform.python_version(),
        "platform": f"{sys.platform} {platform.machine()}",
        "brian2": brian2.__version__,
        "numpy": numpy.__version__,
        "pandas": pandas.__version__,
        "codegen_target": str(brian2.prefs.codegen.target),
        "shiu_model_py_sha256": BY_KEY["shiu_model_py"].sha256,
    }
    try:
        import psutil

        out["peak_rss_mb"] = round(getattr(psutil.Process().memory_info(), "peak_wset", 0) / 2**20, 1)
    except ImportError:
        pass
    return out


CASES = [
    # name, n neurons, edge density, duration ms, kicked neurons, kicks per neuron, silenced, seed
    ("chain", 4, None, 60.0, [0], 6, [], 1),
    ("random-60", 60, 0.12, 300.0, [0, 1, 2, 3, 4], 25, [7], 2),
    ("strong-inhibition", 40, 0.2, 250.0, [0, 1, 2], 40, [], 3),
    ("refractory-pileup", 30, 0.35, 200.0, [0, 1, 2, 3], 60, [5, 6], 4),
]


def make_case(name, n, density, duration_ms, kicked, per, silenced, seed):
    import numpy as np

    rng = np.random.default_rng(seed)
    if density is None:  # a feed-forward chain with strong excitatory links
        pre, post = np.arange(n - 1), np.arange(1, n)
        signed = np.full(n - 1, 200)
    else:
        mask = rng.random((n, n)) < density
        np.fill_diagonal(mask, False)
        pre, post = np.nonzero(mask)
        sign = np.where(rng.random(n) < 0.7, 1, -1)
        if name == "strong-inhibition":
            sign = np.where(rng.random(n) < 0.4, 1, -1)
        counts = rng.integers(1, 30, size=pre.size)
        signed = counts * sign[pre]
    dt_steps = int(duration_ms / 0.1)
    kicks = {}
    for k in kicked:
        for s in rng.choice(np.arange(5, dt_steps - 5), size=per, replace=False).tolist():
            kicks.setdefault(int(s), []).append(int(k))
    return {
        "name": name,
        "n": int(n),
        "duration_ms": duration_ms,
        "pre": pre.astype(int).tolist(),
        "post": post.astype(int).tolist(),
        "signed_count": signed.astype(int).tolist(),
        "kicks": {str(s): v for s, v in sorted(kicks.items())},
        "silenced": list(silenced),
    }


def run_case(shiu, case: dict) -> list[list[int]]:
    import numpy as np
    import pandas as pd
    from brian2 import ms, Network, SpikeGeneratorGroup, Synapses, start_scope

    start_scope()
    params = dict(shiu.default_params)
    n = case["n"]
    with tempfile.TemporaryDirectory() as tmp:
        comp = Path(tmp) / "comp.csv"
        con = Path(tmp) / "con.parquet"
        pd.DataFrame({"Completed": [True] * n}, index=pd.Index(range(1000, 1000 + n))).to_csv(comp)
        pd.DataFrame(
            {
                "Presynaptic_Index": case["pre"],
                "Postsynaptic_Index": case["post"],
                "Excitatory x Connectivity": case["signed_count"],
            }
        ).to_parquet(con)
        neu, syn, spk_mon = shiu.create_model(str(comp), str(con), params)
    syn = shiu.silence(case["silenced"], syn)
    steps = sorted(int(s) for s in case["kicks"])
    src_i, src_t, tgt = [], [], []
    for s in steps:
        for j in case["kicks"][str(s)]:
            src_i.append(len(tgt))
            src_t.append(s * 0.1)
            tgt.append(j)
    for j in set(tgt):
        neu[j].rfc = 0 * ms  # as poi() does for its targets
    gen = SpikeGeneratorGroup(len(tgt), src_i, np.array(src_t) * ms)
    kick = Synapses(gen, neu, on_pre="v += w_syn*f_poi", namespace=params)
    kick.connect(i=list(range(len(tgt))), j=tgt)
    net = Network(neu, syn, spk_mon, gen, kick)
    net.run(case["duration_ms"] * ms)
    t_steps = np.rint(np.asarray(spk_mon.t / ms) / 0.1).astype(int)
    return sorted([int(a), int(b)] for a, b in zip(t_steps, np.asarray(spk_mon.i)))


def cmd_conformance(args) -> int:
    shiu = load_shiu()
    out = {"schema": "fly-neural-brian2-conformance/v1", "environment": env(), "cases": []}
    for spec in CASES:
        case = make_case(*spec)
        t0 = time.monotonic()
        case["brian2_spikes"] = run_case(shiu, case)
        case["wall_s"] = round(time.monotonic() - t0, 3)
        print(f"{case['name']}: {len(case['brian2_spikes'])} spikes", flush=True)
        out["cases"].append(case)
    out["environment"] = env()
    Path(args.out).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8", newline="\n")
    return 0


def cmd_trials(args) -> int:
    import numpy as np
    import pandas as pd
    from brian2 import Hz, ms, seed

    shiu = load_shiu()
    comp = verify("shiu_completeness")
    con = verify("shiu_connectivity")
    params = dict(shiu.default_params)
    params["r_poi"] = args.rate * Hz
    params["r_poi2"] = args.rate2 * Hz
    df_comp = pd.read_csv(comp, index_col=0)
    flyid2i = {j: i for i, j in enumerate(df_comp.index)}
    i2flyid = {i: j for j, i in flyid2i.items()}
    # Published ids absent from this release are dropped and listed, never guessed.
    missing = sorted({x for x in [*args.exc, *(args.exc2 or []), *(args.silence or [])] if x not in flyid2i})
    exc = [flyid2i[x] for x in args.exc if x in flyid2i]
    exc2 = [flyid2i[x] for x in (args.exc2 or []) if x in flyid2i]
    slnc = [flyid2i[x] for x in (args.silence or []) if x in flyid2i]
    results = []
    t_all = time.monotonic()
    for k in range(args.trials):
        s = args.seed + k
        seed(s)
        t0 = time.monotonic()
        spk = shiu.run_trial(exc, exc2, slnc, str(comp), str(con), params)
        counts = {str(i2flyid[i]): int(len(v)) for i, v in spk.items()}
        results.append({"trial": k, "brian2_seed": s, "wall_s": round(time.monotonic() - t0, 2), "counts": counts})
        print(f"trial {k}: {sum(counts.values())} spikes, {results[-1]['wall_s']} s", flush=True)
        Path(args.out).write_text(
            json.dumps(
                {
                    "schema": "fly-neural-brian2-trials/v1",
                    "args": {k2: v for k2, v in vars(args).items() if k2 != "fn"},
                    "missing_ids": missing,
                    "neurons": {"exc": len(exc), "exc2": len(exc2), "silenced": len(slnc)},
                    "t_run_ms": float(params["t_run"] / ms),
                    "environment": env(),
                    "total_wall_s": round(time.monotonic() - t_all, 2),
                    "trials": results,
                },
                indent=1,
            )
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
    return 0


def main(argv=None) -> int:
    os.environ.setdefault("PYTHONHASHSEED", "0")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("conformance")
    c.add_argument("--out", required=True)
    c.set_defaults(fn=cmd_conformance)
    t = sub.add_parser("trials")
    t.add_argument("--exc", type=int, nargs="+", required=True)
    t.add_argument("--exc2", type=int, nargs="*")
    t.add_argument("--silence", type=int, nargs="*")
    t.add_argument("--rate", type=float, default=150.0)
    t.add_argument("--rate2", type=float, default=0.0)
    t.add_argument("--trials", type=int, default=1)
    t.add_argument("--seed", type=int, default=0)
    t.add_argument("--out", required=True)
    t.set_defaults(fn=cmd_trials)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
