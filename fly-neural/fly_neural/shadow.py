"""ECHO Neural Shadow: the connectome model reading what a research fly senses, beside ECHO.

Three modes, named in every recording and result:

- ``baseline``: ECHO controls a research fly; its sensable inputs and ECHO's
  actions are recorded (``scripts/echo-neural-shadow.ts``). No neural model runs.
- ``neural-shadow``: the same recording, replayed offline into the connectome
  model (``analyse``). The model's readouts are compared with what ECHO did.
  Nothing flows back: the recording is finished before the model reads it.
- ``neural-experimental``: a research subject created for the run (never the
  deployed individual, never a copy of it) whose feeding and escape are
  triggered by the model's readouts through ``serve``, while ECHO keeps the
  rest of its behaviour. Its commands still pass the fly's own gate.

Every recording must name a research subject (``research-...``), and both
``analyse`` and ``serve`` refuse one that does not, or that carries a
production path or the deployed individual's identity.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

from . import RESULT_SCHEMA, SHADOW_SCHEMA, lif
from . import connectome as cx
from .record import code_state, environment, sealed
from .resources import Meter
from .sensory import Mapper, describe_mapping, observation

MODES = ("baseline", "neural-shadow", "neural-experimental")
# What the deployed organism and its host are called (deploy/bethesda-life/,
# docs/ECHO_IMMORTAL_ORGANISM.md). A shadow input naming any of them is refused.
PRODUCTION_MARKERS = (
    "/var/lib/bethesda-life",
    "/opt/bethesda-life",
    "/var/backups/bethesda-life",
    "129.213.139.78",
    "129-213-139-78",
    "bethesda-life-",
)


class RefusedSubject(RuntimeError):
    pass


def check_header(h: dict) -> None:
    if h.get("schema") != SHADOW_SCHEMA:
        raise RefusedSubject(f"not a {SHADOW_SCHEMA} recording")
    if h.get("mode") not in MODES:
        raise RefusedSubject(f"unknown mode {h.get('mode')!r}")
    subject = str(h.get("subject", ""))
    if not subject.startswith("research-"):
        raise RefusedSubject(f"subject {subject!r} is not a research subject")
    blob = json.dumps(h)
    for m in PRODUCTION_MARKERS:
        if m in blob:
            raise RefusedSubject(f"recording header names production ({m!r})")
    if h.get("lifeId") or h.get("individual"):
        raise RefusedSubject("recording names an individual; a research subject has none")


def read_recording(path: Path) -> tuple[dict, list[dict]]:
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    head = json.loads(lines[0])
    check_header(head)
    return head, [json.loads(x) for x in lines[1:] if x.strip()]


def analyse(recording: Path, compiled: Path, out_dir: Path, seed: int = 0, log=print) -> dict:
    head, recs = read_recording(recording)
    c = cx.load(compiled)
    net = lif.Network(c)
    mapper = Mapper(c)
    rng = np.random.default_rng(np.random.SeedSequence([seed, len(recs)]))
    state = lif.State(net, rng)
    dt = net.params.dt_ms
    rows = []
    with Meter() as meter:
        for i, r in enumerate(recs):
            obs = observation(r["obs"])
            t_end = recs[i + 1]["t"] if i + 1 < len(recs) else r["t"] + head.get("sample_period_s", 0.01)
            end_ms = (t_end - recs[0]["t"]) * 1000.0
            start_step = state.step
            trial, state = lif.run(net, lif.Stimulus(poisson=mapper.poisson(obs)), end_ms, state=state)
            window_ms = (state.step - start_step) * dt
            if window_ms <= 0:
                continue
            ro = mapper.decode(trial.counts, window_ms)
            rows.append({"t": r["t"], "echo": r["echo"], "outcome": r.get("outcome"), "neural": ro, "rates": {k: v for k, v in mapper.rates(obs).items() if v > 0}})
    summary = compare(rows)
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "shadow",
        "mode": "neural-shadow",
        "recording": {"file": Path(recording).name, "header": head, "records": len(recs)},
        "connectome": {"path_name": Path(compiled).name, "manifest_sha256": c.manifest.get("sha256"), "sign_policy": c.manifest.get("sign_policy")},
        "mapping": describe_mapping(),
        "populations": mapper.report,
        "seed": seed,
        "comparison": summary,
        "windows": len(rows),
        "resources": meter.describe(),
        "environment": environment(),
        "code": code_state(out_dir),
    }
    data = sealed(body)
    from .record import write_json

    name = f"shadow-{Path(recording).stem}.json"
    write_json(out_dir / name, data)
    log(f"wrote {out_dir / name}")
    return data


def _episodes(flags: list[bool], ts: list[float]) -> list[tuple[float, float]]:
    out, start = [], None
    for f, t in zip(flags, ts):
        if f and start is None:
            start = t
        if not f and start is not None:
            out.append((start, t))
            start = None
    if start is not None:
        out.append((start, ts[-1]))
    return out


def compare(rows: list[dict]) -> dict:
    """Per sample: did the model predict what ECHO did? For escape, also per episode and latency."""
    if not rows:
        return {"samples": 0}
    ts = [r["t"] for r in rows]
    out = {"samples": len(rows)}
    echo_escape = [bool(r["echo"].get("escape")) for r in rows]
    echo_feed = [bool(r["echo"].get("feeding")) for r in rows]
    for key, echo in (("escape", echo_escape), ("feed", echo_feed)):
        neural = [r["neural"][key]["predicted"] for r in rows]
        tp = sum(a and b for a, b in zip(echo, neural))
        fp = sum((not a) and b for a, b in zip(echo, neural))
        fn = sum(a and not b for a, b in zip(echo, neural))
        tn = len(rows) - tp - fp - fn
        out[key] = {
            "echo_samples": sum(echo),
            "neural_samples": sum(neural),
            "both": tp,
            "neural_only": fp,
            "echo_only": fn,
            "neither": tn,
            "agreement": round((tp + tn) / len(rows), 4),
        }
    # Escape episodes: ECHO's escape starts, and the first giant-fiber spike near each.
    starts = [t for (t, _) in _episodes(echo_escape, ts)]
    gf = [r["t"] for r in rows if r["neural"]["escape"]["predicted"]]
    lat = []
    for s in starts:
        near = [g - s for g in gf if -0.5 <= g - s <= 0.5]
        lat.append(min(near, key=abs) if near else None)
    out["escape"]["echo_episodes"] = len(starts)
    out["escape"]["episodes_with_gf_spike_within_500ms"] = sum(x is not None for x in lat)
    out["escape"]["gf_minus_echo_latency_s"] = [None if x is None else round(x, 4) for x in lat]
    return out


def serve(compiled: Path, inp=sys.stdin, out=sys.stdout) -> int:
    """JSON lines for a neural-experimental research subject.

    First line: the recording header (checked like a recording's, and it must
    say ``neural-experimental``). Then one request per line, ``{"t": s, "obs":
    {...}}``, answered with the readouts over the window since the previous
    request. The brain's state carries over between requests."""
    head = json.loads(inp.readline())
    check_header(head)
    if head["mode"] != "neural-experimental":
        raise RefusedSubject("serve runs only for a neural-experimental research subject")
    c = cx.load(compiled)
    net = lif.Network(c)
    mapper = Mapper(c)
    state = lif.State(net, np.random.default_rng(np.random.SeedSequence([int(head.get("seed", 0)), 7])))
    t0 = None
    out.write(json.dumps({"ready": True, "neurons": c.n, "populations": {k: v["neurons"] for k, v in mapper.report.items()}}) + "\n")
    out.flush()
    for line in inp:
        if not line.strip():
            continue
        req = json.loads(line)
        if req.get("bye"):
            break
        obs = observation(req["obs"])
        t0 = req["t"] if t0 is None else t0
        start = state.step
        w0 = time.monotonic()
        trial, state = lif.run(net, lif.Stimulus(poisson=mapper.poisson(obs)), (req["t"] - t0) * 1000.0 + float(req.get("window_ms", 10.0)), state=state)
        window_ms = (state.step - start) * net.params.dt_ms
        ro = mapper.decode(trial.counts, window_ms) if window_ms > 0 else {}
        out.write(json.dumps({"t": req["t"], "window_ms": window_ms, "readouts": ro, "compute_ms": round((time.monotonic() - w0) * 1000, 2)}) + "\n")
        out.flush()
    return 0
