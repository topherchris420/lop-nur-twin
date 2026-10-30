"""Benchmarks: what the engine costs on this machine, measured, never estimated.

- ``full-brain``: N one-second trials of Shiu et al.'s sugar stimulus (their
  sugar GRNs at 100 Hz) on each compiled v783 connectome given, with wall
  time, CPU time and resident memory per trial, and the cost of loading.
- ``scaling``: random sparse graphs of growing size (synthetic, not a
  connectome) at the connectome's mean out-degree, driven the same way, to
  show how cost grows with neurons and active synapses.

No GPU is used: the engine is NumPy on one CPU thread, and every result says
``gpu: null``. The Brian 2 reference's own timings are in its run files
(reference/shiu_brian2.py), measured on the same machine.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np

from . import RESULT_SCHEMA, lif, stats
from . import connectome as cx
from . import populations as P
from .record import code_watch, environment, sealed, write_json
from .resources import Meter, machine, peak_rss_mb, rss_mb


def full_brain(compiled: list[Path], trials: int, seed: int) -> list[dict]:
    out = []
    for path in compiled:
        with Meter() as load:
            c = cx.load(path)
            net = lif.Network(c)
        idx, rep = P.resolve("sugar_shiu", c)
        mn9, _ = P.resolve("mn9_shiu", c)
        rows = []
        for k in range(trials):
            with Meter() as m:
                t, _ = lif.run(net, lif.Stimulus(poisson=[lif.Poisson(idx, 100.0)]), 1000.0, rng=np.random.default_rng([seed, k]))
            # mn9_hz: mean over the MN9 neurons present; neurons_touched: left rest at some step.
            rows.append({"mn9_hz": float(t.counts[mn9].mean()), "spikes": t.total_spikes, "neurons_fired": int((t.counts > 0).sum()), "neurons_touched": t.active_neurons, **m.describe()})
        out.append(
            {
                "connectome": path.name,
                "sign_policy": c.manifest.get("sign_policy"),
                "neurons": c.n,
                "pairs": c.pairs,
                "synapses": c.synapses,
                "load": load.describe(),
                "stimulus": {"population": "sugar_shiu", "neurons": int(idx.size), "rate_hz": 100.0, "duration_ms": 1000.0},
                "trials": rows,
                "wall_s_per_simulated_s": stats.summary([r["wall_s"] for r in rows]),
                "cpu_s_per_simulated_s": stats.summary([r["cpu_s"] for r in rows]),
                "rss_end_mb": stats.summary([r["rss_end_mb"] for r in rows]),
            }
        )
    return out


def scaling(sizes: list[int], degree: int, seed: int) -> list[dict]:
    rng = np.random.default_rng(seed)
    out = []
    for n in sizes:
        m = n * degree
        pre = np.sort(rng.integers(0, n, size=m))
        post = rng.integers(0, n - 1, size=m)
        post = post + (post >= pre)
        sign = np.where(rng.random(n) < 0.3, -1, 1).astype(np.int8)
        cnt = rng.geometric(0.3, size=m)
        with Meter() as build:
            c = cx.from_edges(np.arange(1, n + 1, dtype=np.int64), pre, post, cnt, sign)
            net = lif.Network(c)
        # 1% of the neurons driven, so activity grows with the network (cost follows spikes, not size).
        drive = np.arange(max(20, n // 100))
        with Meter() as m_run:
            t, _ = lif.run(net, lif.Stimulus(poisson=[lif.Poisson(drive, 100.0)]), 1000.0, rng=np.random.default_rng(seed))
        events = int((t.counts * np.diff(c.indptr)).sum())
        out.append(
            {
                "neurons": n,
                "pairs": c.pairs,
                "synapses": c.synapses,
                "driven": int(drive.size),
                "build": build.describe(),
                "run": m_run.describe(),
                "spikes": t.total_spikes,
                "synaptic_events": events,
                "neurons_fired": int((t.counts > 0).sum()),
                "neurons_touched": t.active_neurons,
            }
        )
    return out


def run(compiled: list[Path], out_dir: Path, trials: int = 5, sizes: list[int] | None = None, seed: int = 0, log=print) -> dict:
    code = code_watch(out_dir)
    t0 = time.monotonic()
    fb = full_brain(compiled, trials, seed)
    for r in fb:
        log(f"  {r['connectome']}: {r['wall_s_per_simulated_s']['mean']:.2f} s wall per simulated s, MN9 {np.mean([x['mn9_hz'] for x in r['trials']]):.1f} Hz")
    sc = scaling(sizes or [1_000, 10_000, 100_000, 139_255], degree=108, seed=seed)
    for r in sc:
        log(f"  scaling n={r['neurons']}: {r['run']['wall_s']:.2f} s, {r['neurons_fired']} fired")
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "benchmark",
        "full_brain": fb,
        "scaling": {"note": "synthetic random graphs (not a connectome), mean out-degree 108 as in v783 (15,091,983 pairs / 139,255 neurons), 30% inhibitory, 1% of neurons (at least 20) driven at 100 Hz for 1 s; synaptic_events = spikes times out-degree", "rows": sc},
        "gpu": None,
        "threads": "one (NumPy, no parallelism)",
        "machine": machine(),
        "rss_mb_end": rss_mb(),
        "peak_rss_mb_process": peak_rss_mb(),
        "wall_s": round(time.monotonic() - t0, 2),
        "environment": environment(),
        "code": code(),
    }
    data = sealed(body)
    write_json(out_dir / "benchmark.json", data)
    log(f"wrote {out_dir / 'benchmark.json'}")
    return data
