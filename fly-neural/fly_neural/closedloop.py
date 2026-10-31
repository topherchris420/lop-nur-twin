"""Closed-loop neural-experimental control of research subjects: ``experiments/closed-loop-v783.json``.

The merged ``serve`` answers every request with the merged readouts (any
giant-fiber spike; MN9 at 10 Hz) and stops on any error. Here the server
for ``scripts/echo-closed-loop.ts``:

- reads its escape readout from the arm the header names: ``neural-merged``
  (the merged mapping and readout) or ``neural-selected`` (the mapping and
  readout frozen by ``threat-v783-dev.json``'s selection; contrast, which the
  fly's eye has no channel for, is taken as 1);
- answers an observation it cannot accept, or a failure, with
  ``{"t", "error"}`` instead of exiting, so the subject's controller can fall
  back to ECHO for that sample and log it;
- runs under a ``Budget`` (wall time, resident memory, a stop file), and on
  exceeding it answers once with the reason and exits.

``run`` drives the pre-registered experiment: one node process per research
subject, arm and scenario, each spawning this server; their summaries are
judged by the config's criteria and sealed. Each finished run is kept with
its identity (config, commit, cleanliness, source, escape readouts), so
``units`` can split the runs among parallel processes and a final
``resume`` run judges them all, exactly as one process would have.
"""

from __future__ import annotations

import hashlib
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

from . import RESULT_SCHEMA, lif
from . import connectome as cx
from .record import code_watch, environment, load_sealed, sealed, write_json
from .resources import Budget, BudgetExceeded, Meter, machine
from .sensory import Mapper, ObservationError, observation
from .shadow import RefusedSubject, check_header
from .threat import v2_rates

SCHEMA = "fly-neural-closed-loop/v1"
ARMS = ("baseline", "neural-merged", "neural-selected")


def escape_spec(arm: str, results: Path) -> dict:
    if arm == "neural-merged":
        return {"name": "v1/any", "mapping": "v1", "readout": "any"}
    if arm == "neural-selected":
        dev = load_sealed(results / "threat-v783-dev.json", RESULT_SCHEMA)
        s = dev["selected"]
        cfg = json.loads((Path(__file__).parent.parent / "experiments" / dev["config_file"]).read_text(encoding="utf-8"))
        spec = {"name": s["name"], "mapping": s["mapping"], "readout": s["readout"], "from": "threat-v783-dev.json", "from_sha256": dev["sha256"]}
        if s["readout"] == "integrated":
            spec |= {"k": s["k"], "tau_ms": s["tau_ms"], "refractory_s": cfg["readouts"]["integrated"]["refractory_s"]}
        if s["mapping"].startswith("v2"):
            spec |= {"width_deg": cfg["mappings"]["v2"]["constants"]["width_deg"], "expansion_ref_deg_s": cfg["mappings"]["v2"]["constants"]["expansion_ref_deg_s"]}
        return spec
    raise ValueError(f"no escape readout for arm {arm!r}")


class EscapeReadout:
    """The giant fiber's spikes per window, read by ``any`` or by a leaky count with a threshold and a refractory time (in simulated time)."""

    def __init__(self, spec: dict):
        self.spec = spec
        self.level = 0.0
        self.quiet_until = -math.inf

    def __call__(self, t: float, spikes: int, window_ms: float) -> bool:
        if self.spec["readout"] == "any":
            return spikes > 0
        self.level = self.level * math.exp(-window_ms / self.spec["tau_ms"]) + spikes
        if t >= self.quiet_until and self.level >= self.spec["k"]:
            self.quiet_until = t + self.spec["refractory_s"]
            self.level = 0.0
            return True
        return False


class Brain:
    """The full model for one research subject; its state carries over between requests."""

    def __init__(self, compiled: Path, spec: dict, seed: int):
        c = cx.load(compiled)
        self.neurons = c.n
        self.net = lif.Network(c)
        self.mapper = Mapper(c)
        self.spec = spec
        self.gf = np.concatenate([self.mapper.idx["giant_fiber_left"], self.mapper.idx["giant_fiber_right"]])
        self.state = lif.State(self.net, np.random.default_rng(np.random.SeedSequence([seed, 7])))

    def step(self, obs: dict, end_ms: float, budget: Budget) -> tuple[dict, int, float]:
        """Runs to ``end_ms`` (absolute); returns the merged readouts, the giant fiber's spikes and the window simulated."""
        m, s = self.mapper, self.spec
        rates = m.rates(obs) if s["mapping"] == "v1" else v2_rates(m, obs, 1.0, float(s["mapping"].split("@")[1]), s["width_deg"], s["expansion_ref_deg_s"])
        stim = lif.Stimulus(poisson=[lif.Poisson(m.idx[k], r, label=k) for k, r in rates.items() if m.idx[k].size])
        start = self.state.step
        trial, self.state = lif.run(self.net, stim, end_ms, state=self.state, budget=budget)
        window_ms = (self.state.step - start) * self.net.params.dt_ms
        if window_ms <= 0:
            return {"feed": {"predicted": False, "mean_rate_hz": 0.0, "spikes": 0}, "escape": {"predicted": False, "mean_rate_hz": 0.0, "spikes": 0}}, 0, 0.0
        return m.decode(trial.counts, window_ms), int(trial.counts[self.gf].sum()), window_ms


def serve(compiled: Path, results: Path, inp=sys.stdin, out=sys.stdout, brain=Brain) -> int:
    """JSON lines for ``scripts/echo-closed-loop.ts``.

    First line: the run's header (checked like a recording's; it must say
    ``neural-experimental`` and name a neural arm). Then one request per line,
    ``{"id", "t", "obs"}``, answered with ``{"id", "t", "readouts", ...}``, or
    with ``{"id", "t", "error"}`` when the request cannot be served; the
    server carries on. Past its budget it answers ``"fatal": true`` and exits."""
    head = json.loads(inp.readline())
    check_header(head)
    if head["mode"] != "neural-experimental" or head.get("arm") not in ARMS[1:]:
        raise RefusedSubject("closed-loop serve runs only for a neural-experimental research subject with a neural arm")
    spec = escape_spec(head["arm"], results)
    b = head.get("budget", {})
    budget = Budget(max_wall_s=b.get("max_wall_s"), max_rss_mb=b.get("max_rss_mb"), stop_file=Path(b["stop_file"]) if b.get("stop_file") else None, check_every_steps=100)
    model = brain(compiled, spec, int(head.get("seed", 0)))
    escape = EscapeReadout(spec)
    t0 = last = None

    def say(msg: dict) -> None:
        out.write(json.dumps(msg) + "\n")
        out.flush()

    say({"ready": True, "neurons": model.neurons, "escape_readout": spec, "budget": budget.describe()})
    for line in inp:
        if not line.strip():
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            say({"id": None, "t": None, "error": "request is not JSON"})
            continue
        if not isinstance(req, dict):
            say({"id": None, "t": None, "error": "request is not an object"})
            continue
        if req.get("bye"):
            break
        rid, t = req.get("id"), req.get("t")
        try:
            budget.check()
            if not isinstance(t, (int, float)) or not math.isfinite(t) or (last is not None and t <= last):
                raise ValueError(f"bad time {t!r}: requests must move forward")
            obs = observation(req["obs"])
            t0 = t if t0 is None else t0
            w0 = time.monotonic()
            ro, gf, window_ms = model.step(obs, (t - t0) * 1000.0 + float(req.get("window_ms", 10.0)), budget)
            last = t
            ro["escape"] = {**ro["escape"], "spikes": gf, "predicted": bool(escape(float(t), gf, window_ms)), "level": round(escape.level, 4)}
            say({"id": rid, "t": t, "window_ms": window_ms, "readouts": ro, "compute_ms": round((time.monotonic() - w0) * 1000, 2)})
        except BudgetExceeded as e:
            say({"id": rid, "t": t, "error": f"budget: {e.reason}", "fatal": True})
            return 4
        except (ObservationError, KeyError, TypeError, ValueError) as e:
            say({"id": rid, "t": t, "error": f"{type(e).__name__}: {e}"})
    return 0


def _cfg(path: Path) -> tuple[dict, str]:
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    if cfg.get("schema") != SCHEMA:
        raise ValueError(f"{path} is not a {SCHEMA} file")
    return cfg, hashlib.sha256(Path(path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def run(cfg_path: Path, split: str, repo: Path, results: Path, out_dir: Path, python: str, log=print, units: list[str] | None = None, resume: bool = False) -> dict:
    code = code_watch(out_dir)
    cfg, config_sha256 = _cfg(cfg_path)
    work = repo / ".fly-neural" / "closed-loop"
    work.mkdir(parents=True, exist_ok=True)
    every = [f"{sc}:{seed}:{arm}" for sc in cfg["scenarios"] for seed in cfg["seeds"][split] for arm in cfg["arms"]]
    if units is not None and set(units) - set(every):
        raise ValueError(f"no such run in the {split} split: {sorted(set(units) - set(every))}")
    readouts = {a: escape_spec(a, results) for a in cfg["arms"] if a != "baseline"}
    ident = {"config_sha256": config_sha256, "readouts_sha256": hashlib.sha256(json.dumps(readouts, sort_keys=True).encode()).hexdigest(), **{k: code.start.get(k) for k in ("commit", "dirty", "fly_neural")}}
    runs = []
    with Meter() as meter:
        for scenario in cfg["scenarios"]:
            for seed in cfg["seeds"][split]:
                for arm in cfg["arms"]:
                    if units is not None and f"{scenario}:{seed}:{arm}" not in units:
                        continue
                    kept = work / f"{split}-{scenario}-{seed}-{arm}.row.json"
                    if resume and kept.exists():
                        old = json.loads(kept.read_text(encoding="utf-8"))
                        if old.get("ident") == ident:
                            runs.append({**old["row"], "resumed": True})
                            log(f"  {split} {scenario} {seed} {arm}: resumed")
                            continue
                    summary = work / f"{split}-{scenario}-{seed}-{arm}.json"
                    summary.unlink(missing_ok=True)
                    cmd = ["node", "scripts/run-ts.mjs", "scripts/echo-closed-loop.ts", "--scenario", scenario, "--seed", str(seed), "--arm", arm, "--seconds", str(cfg["seconds"]), "--python", python, "--summary", str(summary.relative_to(repo)).replace("\\", "/")]
                    w0 = time.monotonic()
                    p = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, timeout=cfg["limits"]["run_timeout_s"])
                    row = {"scenario": scenario, "seed": seed, "arm": arm, "exit": p.returncode, "wall_s": round(time.monotonic() - w0, 2)}
                    if summary.exists():
                        row["summary"] = json.loads(summary.read_text(encoding="utf-8"))
                    else:
                        row["stderr_tail"] = p.stderr[-2000:]
                    runs.append(row)
                    write_json(kept, {"ident": ident, "row": row})
                    log(f"  {split} {scenario} {seed} {arm}: exit {p.returncode}, {json.dumps((row.get('summary') or {}).get('outcome'))}")
    if units is not None:
        return {"ran": [f"{r['scenario']}:{r['seed']}:{r['arm']}" for r in runs], "failed": []}
    verdicts = [judge(cr, runs) for cr in cfg["criteria"] if cr.get("split", split) == split]
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "closed-loop",
        "experiment": cfg["id"],
        "config_file": Path(cfg_path).name,
        "config_sha256": config_sha256,
        "split": split,
        "escape_readouts": readouts,
        "runs": runs,
        "criteria": verdicts,
        "failed": [v["id"] for v in verdicts if not v["passed"]],
        "resources": {**meter.describe(), "machine": machine()},
        "environment": environment(),
        "code": code(),
    }
    data = sealed(body)
    write_json(out_dir / f"{cfg['id']}-{split}.json", data)
    log(f"wrote {out_dir / (cfg['id'] + '-' + split + '.json')}; failed {data['failed']}")
    return data


def _sum(runs, arm, scenario, f):
    return [f(r["summary"]) for r in runs if r["arm"] == arm and r["scenario"] == scenario and r.get("summary")]


def judge(cr: dict, runs: list[dict]) -> dict:
    v = {"id": cr["id"], "claim": cr["claim"], "test": cr["test"]}
    t = cr["test"]
    neural = [r for r in runs if r["arm"] != "baseline"]
    if t == "completed":
        bad = [f"{r['scenario']}/{r['seed']}/{r['arm']}" for r in neural if not r.get("summary") or r["summary"]["outcome"]["aborted"]]
        v.update(incomplete=bad, passed=not bad)
    elif t == "fallback_bound":
        fr = {f"{r['scenario']}/{r['seed']}/{r['arm']}": r["summary"]["fallbacks"]["fraction"] for r in neural if r.get("summary")}
        v.update(fractions=fr, passed=bool(fr) and all(x <= cr["max_fraction"] for x in fr.values()))
    elif t == "produced":
        issued = sum(_sum(runs, cr["arm"], cr["scenario"], lambda s: s["neural"][cr["field_issued"]]))
        done = sum(_sum(runs, cr["arm"], cr["scenario"], lambda s: s["neural"][cr["field_done"]]))
        ratio = done / issued if issued else None
        v.update(issued=issued, executed=done, ratio=ratio, passed=ratio is not None and ratio >= cr["min_ratio"], wording=("control" if ratio is not None and ratio >= cr["min_ratio"] else "predictive"))
    elif t == "at_most":
        a = sum(_sum(runs, cr["a"], cr["scenario"], lambda s: s["counts"][cr["field"]]))
        b = sum(_sum(runs, cr["b"], cr["scenario"], lambda s: s["counts"][cr["field"]]))
        v.update(a=a, b=b, passed=a <= b)
    elif t == "rate_at_least":
        num = sum(_sum(runs, cr["arm"], cr["scenario"], lambda s: s["counts"][cr["numerator"]]))
        den = sum(_sum(runs, cr["arm"], cr["scenario"], lambda s: s["counts"][cr["denominator"]]))
        rate = num / den if den else None
        v.update(numerator=num, denominator=den, rate=rate, passed=rate is not None and rate >= cr["value"])
    elif t == "report_only":
        v.update(passed=True, note="reported, not judged")
    else:
        raise ValueError(t)
    return v
