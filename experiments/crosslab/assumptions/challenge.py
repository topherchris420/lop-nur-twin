"""Offline, bounded model-led challenge; never reads or writes organism state."""
from bisect import bisect_left, bisect_right
from dataclasses import replace
from hashlib import sha256
import json
import math
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import numpy as np
import jsonschema

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(ROOT.parent / "replication"))
from acquisition import available_rate, truth_rate
from run import check_checkout, digest, load, put

PROFILES = ("constant", "rising", "falling")
DESIGNS = ("delivery", "mask_position", "optical_noise")


def probability_schema():
    return {"type": "number", "minimum": 0, "maximum": 1}


def object_schema(properties):
    return {"type": "object", "additionalProperties": False,
            "required": list(properties), "properties": properties}


def schema(revise=False):
    text = {"type": "string", "minLength": 20, "maxLength": 1000}
    if revise:
        return object_schema({"explanation": text, "falsifier": text,
                              "probabilities": object_schema({p: probability_schema() for p in PROFILES})})
    pair = {"type": "array", "minItems": 2, "maxItems": 2, "items": probability_schema()}
    return object_schema({"assumption": text, "rival": text,
                          "forecasts": object_schema({d: object_schema({p: pair for p in PROFILES}) for d in DESIGNS})})


def make_request(protocol, previous=None, discovery=None):
    if previous is None:
        historical = load(ROOT.parent / "planning/record/result.json")
        question = {
            "historical_measurements": historical,
            "methods": "CIRCLE averages valid beat intervals ending in the last 20 seconds. The gate requires at least 65% interval coverage and an optical sample acquired in the last 0.5 seconds available by the decision. Motion episodes exclude intervals with either endpoint inside them. Reference is all true intervals ending in the same window. Data are simulated.",
            "candidate_experiments": protocol["catalog"],
            "profiles": protocol["profile_description"], "event": protocol["event"],
            "task": "State your working scientific assumption explaining these past observations, and a competing explanation. For every candidate and profile give [probability of the event under your assumption, probability under your rival]. Use distinct, testable explanations. The host will choose one design by your forecasts' expected information gain at equal priors. These are your predictions, not known simulator probabilities. You may doubt the previous result. Do not manufacture outcomes. No new experimental results are available.",
        }
    else:
        question = {
            "previous_proposal": previous, "discovery_measurements": discovery,
            "event": protocol["event"], "replication_change": "New seeds and asymmetric pulse shapes; same profile families and intervention. No replication outcomes are available.",
            "task": "Examine your own prediction against these measurements. State a revised or retained explanation and an observable result that would refute it. Forecast the event probability for each profile in replication. You are not required to change your mind or claim success. Do not claim physical validation or causality beyond the controls.",
        }
    return {"schemaName": "rain_assumption_revision" if previous else "rain_assumption_proposal",
            "schema": schema(previous is not None),
            "system": "You are R.A.I.N.'s local scientific planner. Distinguish a prediction from a measurement. Return only the requested JSON. Your output cannot execute code or change the protocol.",
            "user": json.dumps(question, sort_keys=True)}


def admit(receipt, request):
    if receipt["request"] != request:
        raise ValueError("Model request differs from the registered evidence")
    answer = receipt["answer"]
    if answer.get("finishReason") != "stop":
        raise ValueError("Model failed; no scripted fallback")
    value = json.loads(answer["text"])
    jsonschema.validate(value, request["schema"])
    # jsonschema's number accepts NaN; reject it and bool explicitly.
    def finite(v):
        if isinstance(v, dict):
            return all(finite(x) for x in v.values())
        if isinstance(v, list):
            return all(finite(x) for x in v)
        return not isinstance(v, (float, int)) or (not isinstance(v, bool) and math.isfinite(v))
    if not finite(value):
        raise ValueError("Non-finite model forecast")
    if "assumption" in value and value["assumption"].strip().lower() == value["rival"].strip().lower():
        raise ValueError("Identical rival explanations")
    return value


def entropy(p):
    return 0 if p in (0, 1) else -p * math.log2(p) - (1-p) * math.log2(1-p)


def select(proposal):
    gains = {d: sum(entropy((a+b)/2) - (entropy(a)+entropy(b))/2
                    for a, b in proposal["forecasts"][d].values()) / len(PROFILES) for d in DESIGNS}
    return {"design": max(DESIGNS, key=lambda d: gains[d]), "model_conditional_bits": gains}


def signal(seed, profile, waveform, protocol):
    """Two optical shapes on a synthetic grid, using real CIRCLE reconstruction."""
    from models.physiology.streams import RawSession, Stream
    rng = np.random.default_rng(seed)
    offset = float(rng.uniform(-4, 4))
    phase = float(rng.uniform(0.05, 0.5))
    cutoff, width = protocol["cutoff_seconds"], protocol["window_seconds"]
    def rate(t):
        f = min(1, max(0, (t - (cutoff-width))/width))
        return (90 if profile == "constant" else 60 + 60*f if profile == "rising" else 120 - 60*f) + offset
    beats = [phase]
    while beats[-1] < cutoff + 2:
        beats.append(beats[-1] + 60/rate(beats[-1]))
    t = np.arange(cutoff * protocol["sample_rate_hz"] + 1) / protocol["sample_rate_hz"]
    pulse = np.zeros_like(t)
    if waveform == "gaussian":
        for b in beats:
            pulse += np.exp(-((t-b)/0.065)**2) + 0.15*np.exp(-((t-b-0.22)/0.08)**2)
        peaks = beats
    elif waveform == "asymmetric":
        for b in beats:
            lag = np.maximum(t-b, 0)
            pulse += lag*np.exp(-lag/0.045)/(0.045/math.e)
        peaks = [b+0.045 for b in beats]
    else:
        raise ValueError("Unregistered waveform")
    noise = rng.normal(0, 10, len(t))
    values = {"ir_counts": np.rint(96000-1500*pulse+noise).astype(np.int64),
              "red_counts": np.rint(71000-900*pulse+noise).astype(np.int64)}
    stream = Stream("ppg", np.arange(len(t)), np.rint(t*1e6).astype(np.int64), values)
    return RawSession({"ppg": stream}, {"ppg": {"nominal_rate_hz": protocol["sample_rate_hz"]}}), peaks


def acquire(protocol, phase, designs):
    from models.physiology.pipeline import detect_beats
    rows = []
    cutoff, width = protocol["cutoff_seconds"], protocol["window_seconds"]
    ev = SimpleNamespace(window_start_us=0, input_cutoff_us=cutoff*1_000_000,
                         decision_time_us=cutoff*1_000_000)
    cfg = SimpleNamespace(hr_window_s=width)
    for seed in protocol[f"{phase}_seeds"]:
        for profile in PROFILES:
            raw, beats = signal(seed, profile, protocol[f"{phase}_waveform"], protocol)
            first, last = bisect_left(beats, cutoff-width), bisect_right(beats, cutoff)
            reference_beats = beats[max(0, first-1):last]
            reference = truth_rate(reference_beats)
            for design in designs:
                for level in protocol["catalog"][design]["levels"]:
                    stream = raw.streams["ppg"]
                    mask = []
                    if design == "delivery" and level == "delayed":
                        stream = replace(stream, available_us=stream.available_us+3_000_000)
                    if design == "mask_position":
                        start = cutoff-width+1 if level == "early" else cutoff-5
                        mask = [(start, start+3)]
                    if design == "optical_noise" and level == "noisy":
                        t = stream.device_time_us / 1e6
                        chirp = np.where(t >= cutoff-width, 1200*np.sin(2*np.pi*(1.3*t+0.01*t*t)), 0)
                        stream = replace(stream, columns={k: np.rint(v+chirp).astype(np.int64) for k, v in stream.columns.items()})
                    feed = replace(raw, streams={"ppg": stream})
                    estimate, coverage = available_rate(feed, ev, cfg, mask)
                    unmasked, unmasked_coverage = available_rate(feed, ev, cfg, [])
                    visible = stream.until(ev.decision_time_us).window(0, ev.input_cutoff_us)
                    detected = detect_beats(visible, raw.descriptors["ppg"], mask)
                    intervals = [(float(a), float(b)) for a, b, valid in zip(detected["ibi_start_s"], detected["ibi_end_s"], detected["ibi_valid"])
                                 if valid and b >= cutoff-width]
                    oracle_intervals = [(a,b) for a,b in zip(reference_beats,reference_beats[1:])
                                        if not any(lo <= a <= hi or lo <= b <= hi for lo,hi in mask)]
                    oracle = 60*len(oracle_intervals)/sum(b-a for a,b in oracle_intervals) if oracle_intervals else None
                    fresh = bool(len(visible.window(ev.input_cutoff_us-round(protocol["maximum_sample_age_seconds"]*1e6), ev.input_cutoff_us)))
                    accepted = estimate is not None and coverage >= protocol["minimum_beat_coverage"] and fresh
                    raw_hash = sha256(stream.device_time_us.tobytes()+stream.available_us.tobytes()+stream.columns["ir_counts"].tobytes()).hexdigest()
                    rows.append({"seed": seed, "profile": profile, "design": design, "level": level,
                                 "waveform": protocol[f"{phase}_waveform"], "estimate": estimate,
                                 "coverage": coverage, "fresh": fresh, "accepted": accepted,
                                 "reference": reference, "reference_beats": reference_beats,
                                 "error": bool(accepted and abs(estimate-reference) > protocol["error_bpm"]),
                                 "intervals": intervals, "mask": mask, "raw_sha256": raw_hash,
                                 "oracle": oracle, "oracle_intervals": oracle_intervals,
                                 "unmasked": unmasked, "unmasked_coverage": unmasked_coverage})
    return rows


def summary(rows):
    result = {}
    for design in sorted({r["design"] for r in rows}):
        result[design] = {}
        for profile in PROFILES:
            group = [r for r in rows if (r["design"], r["profile"]) == (design, profile)]
            seeds = sorted({r["seed"] for r in group})
            events = [int(any(r["error"] for r in group if r["seed"] == s)) for s in seeds]
            levels = {}
            for level in sorted({r["level"] for r in group}):
                g = [r for r in group if r["level"] == level]
                levels[level] = {"scheduled": len(g), "accepted": sum(r["accepted"] for r in g),
                                 "errors": sum(r["error"] for r in g),
                                 "mean_signed_error_all_available": float(np.mean([r["estimate"]-r["reference"] for r in g if r["estimate"] is not None])),
                                 "mean_oracle_signed_error": float(np.mean([r["oracle"]-r["reference"] for r in g if r["oracle"] is not None])),
                                 "mean_unmasked_signed_error": float(np.mean([r["unmasked"]-r["reference"] for r in g if r["unmasked"] is not None]))}
            result[design][profile] = {"seed_events": events, "seeds": seeds, "event_count": sum(events),
                                       "seed_count": len(seeds), "levels": levels}
    return result


def infer(workspace, name, request):
    request_file, output = workspace/f"{name}-request.json", workspace/f"{name}-model.json"
    put(request_file, request)
    subprocess.run(["node", "scripts/run-ts.mjs", "scripts/rain-assumption-model.ts", str(request_file), str(output)],
                   cwd=REPO, check=True, timeout=150)
    receipt = load(output)
    if receipt["request_sha256"] != digest(request_file):
        raise ValueError("Request receipt digest mismatch")
    return admit(receipt, request)


def execute(circle, workspace):
    protocol = load(ROOT/"protocol.json")
    check_checkout(circle, protocol["circle_revision"])
    sys.path.insert(0, str(circle))
    workspace.mkdir(parents=True, exist_ok=False)
    put(workspace/"protocol.json", protocol)
    # The plan is persisted before any experimental measurements are generated.
    proposal = infer(workspace, "proposal", make_request(protocol))
    choice = select(proposal)
    put(workspace/"selection.json", choice)
    designs = list(dict.fromkeys([choice["design"], protocol["fixed_baseline"]]))
    discovery = acquire(protocol, "discovery", designs)
    put(workspace/"discovery-windows.json", discovery)
    public_result = summary(discovery)[choice["design"]]
    put(workspace/"discovery-summary.json", summary(discovery))
    infer(workspace, "revision", make_request(protocol, proposal, public_result))
    replication = acquire(protocol, "replication", designs)
    put(workspace/"replication-windows.json", replication)
    put(workspace/"replication-summary.json", summary(replication))
    # Preserve evidence before evaluation. Timestamps are actual, not preregistration proof.
    from datetime import datetime, timezone
    put(workspace/"provenance.json", {
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
        "source_files": {str(p.relative_to(REPO)): digest(p) for p in [ROOT/"challenge.py", ROOT/"verify.py", ROOT/"protocol.json", REPO/"scripts/rain-assumption-model.ts", ROOT.parent/"replication/acquisition.py"]},
        "historical_result_sha256": digest(ROOT.parent/"planning/record/result.json"),
        "circle_revision": protocol["circle_revision"], "numpy": np.__version__,
        "human_review": "pending", "independent_lab_replication": False,
    })
    put(workspace/"sha256.json", {p.name: digest(p) for p in sorted(workspace.glob("*.json"))})


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("circle", type=Path)
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--replay", action="store_true")
    args = parser.parse_args()
    if args.replay:
        from verify import verify
        verify(args.workspace.resolve())
        p = load(ROOT/"protocol.json")
        check_checkout(args.circle.resolve(), p["circle_revision"])
        sys.path.insert(0, str(args.circle.resolve()))
        designs = list(dict.fromkeys([load(args.workspace/"selection.json")["design"], p["fixed_baseline"]]))
        for phase in ("discovery", "replication"):
            actual = acquire(p, phase, designs)
            expected = load(args.workspace/f"{phase}-windows.json")
            if json.loads(json.dumps(actual)) != expected:
                raise ValueError(f"{phase} simulation did not reproduce")
        print("Both waveforms and disjoint seed sets replay exactly.")
    else:
        execute(args.circle.resolve(), args.workspace.resolve())
