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
from .record import code_watch, environment, sealed
from .resources import Meter
from .sensory import MAPPING_DATASET, RATE_WINDOW_MS, V3, Mapper, TrailingReadout, check_mapping, describe_mapping, observation

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
    # The deployed individual (its public witness, /v1/now, names it).
    "04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921",
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
    code = code_watch(out_dir)
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
        "recording": {"file": Path(recording).name, "sha256": __import__("hashlib").sha256(Path(recording).read_bytes()).hexdigest(), "header": head, "records": len(recs)},
        "connectome": {"path_name": Path(compiled).name, "manifest_sha256": c.manifest.get("sha256"), "sign_policy": c.manifest.get("sign_policy")},
        "mapping": describe_mapping(),
        "populations": mapper.report,
        "seed": seed,
        "comparison": summary,
        "windows": len(rows),
        # Every sample where the model's readouts fired or ECHO acted, for inspection.
        "trace": [
            {"t": round(r["t"], 3), "gf_spikes": r["neural"]["escape"]["spikes"], "mn9_hz": r["neural"]["feed"]["mean_rate_hz"], "echo": (r.get("echo") or {}).get("mode"), "echo_escape": bool((r.get("echo") or {}).get("escape")), "body": (r.get("outcome") or {}).get("mode"), "input_hz": r["rates"]}
            for r in rows
            if r["neural"]["escape"]["spikes"] or r["neural"]["feed"]["spikes"] or (r.get("echo") or {}).get("escape")
        ][:5000],
        "resources": meter.describe(),
        "environment": environment(),
        "code": code(),
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


def compare(rows: list[dict], match_s: float = 0.5) -> dict:
    """What the model predicted against what ECHO did.

    Escape is scored by onsets: each escape command ECHO gave (its reflex)
    against the episodes of giant-fiber firing in the model, matched within
    ``match_s``; unmatched GF episodes are false alarms. Feeding is scored per
    sample: the body feeding (ECHO's own state) against MN9 above threshold.
    """
    if not rows:
        return {"samples": 0}
    ts = [r["t"] for r in rows]
    out: dict = {"samples": len(rows), "match_window_s": match_s}
    onsets = [r["t"] for r in rows if (r.get("echo") or {}).get("escape")]
    gf = [r["neural"]["escape"]["predicted"] for r in rows]
    gf_eps = [s for s, _ in _episodes(gf, ts)]
    used, lat = set(), []
    for s in onsets:
        best = None
        for k, g in enumerate(gf_eps):
            if k not in used and abs(g - s) <= match_s and (best is None or abs(g - s) < abs(gf_eps[best] - s)):
                best = k
        if best is None:
            lat.append(None)
        else:
            used.add(best)
            lat.append(round(gf_eps[best] - s, 4))
    out["escape"] = {
        "echo_onsets": len(onsets),
        "model_gf_episodes": len(gf_eps),
        "hits": sum(x is not None for x in lat),
        "misses": sum(x is None for x in lat),
        "false_alarms": len(gf_eps) - len(used),
        "gf_minus_echo_latency_s": lat,
        "samples_with_gf_spike": sum(gf),
    }
    feeding = [(r.get("outcome") or {}).get("mode") == "feed" for r in rows]
    mn9 = [r["neural"]["feed"]["predicted"] for r in rows]
    tp = sum(a and b for a, b in zip(feeding, mn9))
    fp = sum((not a) and b for a, b in zip(feeding, mn9))
    fn = sum(a and not b for a, b in zip(feeding, mn9))
    tn = len(rows) - tp - fp - fn
    out["feed"] = {
        "echo_feeding_samples": sum(feeding),
        "model_mn9_samples": sum(mn9),
        "both": tp,
        "model_only": fp,
        "echo_only": fn,
        "neither": tn,
        "agreement": round((tp + tn) / len(rows), 4),
    }
    return out


def serve(compiled: Path, inp=sys.stdin, out=sys.stdout) -> int:
    """JSON lines for a neural-experimental research subject.

    First line: the recording header (checked like a recording's, and it must
    say ``neural-experimental``). Then one request per line, ``{"t": s, "obs":
    {...}}``, answered with the readouts over the window since the previous
    request. The brain's state carries over between requests.

    The header's ``mapping`` picks the sensory mapping (``sensory.MAPPINGS``;
    ``v1`` when absent). ``whole-brain/v2`` adds the small-object channel and
    the descending readouts, read over ``rate_window_ms`` (default 100).
    ``brain-and-cord/v3`` needs the BANC v888 connectome (``--connectome
    banc-v888-predicted-nt``): v2's readouts on BANC's neurons, food tasted
    through the legs, and the cord's motor neurons reported (``jump``,
    ``motor``). A mapping on the other dataset's connectome is refused."""
    head = json.loads(inp.readline())
    check_header(head)
    if head["mode"] != "neural-experimental":
        raise RefusedSubject("serve runs only for a neural-experimental research subject")
    mapping = check_mapping(str(head.get("mapping", "v1")))
    c = cx.load(compiled)
    net = lif.Network(c)
    mapper = Mapper(c, mapping)
    trailing = TrailingReadout(mapper.idx, float(head.get("rate_window_ms", RATE_WINDOW_MS)), mapping) if mapping != "v1" else None
    state = lif.State(net, np.random.default_rng(np.random.SeedSequence([int(head.get("seed", 0)), 7])))
    t0 = None
    ready = {"ready": True, "neurons": c.n, "populations": {k: v["neurons"] for k, v in mapper.report.items()}}
    if trailing:
        ready.update({"mapping": mapping, "rate_window_ms": trailing.window_ms})
    if mapping == V3:
        ready.update({"dataset": MAPPING_DATASET[mapping], "pairs": c.pairs, "synapses": c.synapses})
    out.write(json.dumps(ready) + "\n")
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
        if trailing:
            ro = trailing.update(trial.counts, window_ms) if window_ms > 0 else {}
        else:
            ro = mapper.decode(trial.counts, window_ms) if window_ms > 0 else {}
        out.write(json.dumps({"t": req["t"], "window_ms": window_ms, "readouts": ro, "compute_ms": round((time.monotonic() - w0) * 1000, 2)}) + "\n")
        out.flush()
    return 0
