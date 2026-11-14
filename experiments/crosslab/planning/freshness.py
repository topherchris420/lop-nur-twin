"""Pair identical optical sample values with timely or delayed delivery."""

import argparse
from bisect import bisect_left, bisect_right
from dataclasses import replace
import json
import math
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "replication"))
from acquisition import available_rate, independent_ppg, truth_rate
from run import check_checkout, digest, load, put


def delay(stream, seconds):
    """Preserve values and acquisition times, shifting availability in one interval."""
    affected = (stream.device_time_us >= 235_000_000) & (stream.device_time_us < 285_000_000)
    available = stream.available_us + affected * round(seconds * 1e6)
    return replace(stream, available_us=np.maximum.accumulate(available))


def stress_pulse(run, seed):
    """A jittered asymmetric pulse train with independently seeded impulse noise."""
    rng = np.random.default_rng(seed + 720_000)
    beats = [0.2]
    while beats[-1] < 360:
        t = beats[-1]
        beats.append(t + 60 / (85 + 9 * math.sin(t / 20)) + float(rng.uniform(-0.03, 0.03)))
    ppg = run.raw.streams["ppg"]
    t = run.rig.clock.to_true_s(ppg.device_time_us)
    i = np.clip(np.searchsorted(beats, t, side="right") - 1, 0, len(beats) - 1)
    lag = t - np.asarray(beats)[i]
    pulse = np.maximum(lag, 0) * np.exp(-np.maximum(lag, 0) / 0.045) / (0.045 / math.e)
    noise = rng.normal(0, 35, len(t))
    for start, stop in ((236, 258), (268, 282)):
        inside = (t >= start) & (t < stop)
        noise[inside] += 1000 * np.sin(2 * np.pi * (t[inside] - start) ** 1.15)
        noise[inside] += rng.laplace(0, 110, int(inside.sum()))
    stream = replace(ppg, columns={"ir_counts": np.rint(96000 - 1550 * pulse + noise).astype(int),
                                   "red_counts": np.rint(71000 - 920 * pulse + 0.6 * noise).astype(int)})
    peaks = [round(x + 0.045, 6) for x in beats]
    return {"beats": peaks, "raw": replace(run.raw, streams={**run.raw.streams, "ppg": stream})}


def score(rows, protocol):
    """Bootstrap whole paired seeds. Separately bound the seed-level event risk."""
    seeds = sorted({r["seed"] for r in rows})
    totals = []
    for seed in seeds:
        group = [r for r in rows if r["seed"] == seed]
        accepts = [r for r in group if r["available"] and r["coverage"] >= protocol["beat_coverage"]]
        fresh = [r for r in accepts if r["fresh"]]
        totals.append([len(group), len(accepts), len(fresh), sum(r["error"] for r in accepts),
                       sum(r["error"] for r in fresh)])
    totals = np.array(totals)
    n, base, gate, base_error, gate_error = map(int, totals.sum(axis=0))
    rng = np.random.default_rng(619)
    draws = totals[rng.integers(0, len(seeds), (protocol["resamples"], len(seeds)))].sum(axis=1)
    delta = (draws[:, 2] - draws[:, 1]) / draws[:, 0]
    error_events = int((totals[:, 4] > 0).sum())
    return {"windows": n, "paired_seeds": len(seeds), "coverage_only_accepted": base,
            "freshness_accepted": gate, "coverage_only_errors": base_error, "freshness_errors": gate_error,
            "coverage_delta_percentile_95": np.quantile(delta, [0.025, 0.975]).tolist(),
            "seed_clusters_with_freshness_error": error_events,
            "zero_event_one_sided_95_upper_seed_probability": 1 - 0.05**(1 / len(seeds)) if not error_events else None}


def run(protocol):
    from models.physiology.experiment import run_session
    from models.physiology.pipeline import analyze_motion
    from models.physiology.scenarios import SCENARIOS

    rows = []
    for seed in protocol["seeds"]:
        session = run_session(replace(SCENARIOS["motion_heavy"].configure(seed), actuate=False))
        generators = {
            "circle": {"raw": session.raw, "beats": sorted(float(b["systolic_s"]) for b in session.twin.truth()["beats"])},
            "independent_pulse": independent_ppg(session, seed, "motion_heavy"),
            "asymmetric_impulse": stress_pulse(session, seed),
        }
        cfg = session.config.controller
        for name, data in generators.items():
            raw = data["raw"]
            pulse = raw.streams["ppg"]
            feeds = {"timely": raw, "delayed": replace(raw, streams={
                **raw.streams, "ppg": delay(pulse, protocol["delay_seconds"]),
            })}
            for ev in session.evaluations:
                if not 230 <= float(session.rig.clock.to_true_s(ev.input_cutoff_us)) < 330:
                    continue
                true = session.rig.clock.to_true_s
                beats = data["beats"]
                first = bisect_left(beats, float(true(ev.window_start_us)))
                low = bisect_left(beats, float(true(ev.input_cutoff_us - round(cfg.hr_window_s * 1e6))))
                last = bisect_right(beats, float(true(ev.input_cutoff_us)))
                ref = truth_rate(beats[max(first + 1, low) - 1:last])
                imu = raw.streams["imu"].until(ev.decision_time_us).window(ev.window_start_us, ev.input_cutoff_us)
                episodes = analyze_motion(imu, raw.descriptors["imu"])["episodes"]
                for condition, feed in feeds.items():
                    estimate, coverage = available_rate(feed, ev, cfg, episodes)
                    latest = feed.streams["ppg"].until(ev.decision_time_us).window(
                        ev.input_cutoff_us - round(protocol["age_seconds"] * 1e6), ev.input_cutoff_us)
                    rows.append({"seed": seed, "generator": name, "feed": condition, "cutoff": ev.input_cutoff_us,
                                 "available": estimate is not None, "estimate": estimate, "reference": ref,
                                 "coverage": coverage, "fresh": bool(len(latest)),
                                 "error": estimate is not None and abs(estimate-ref) > protocol["error_bpm"]})
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("circle", type=Path)
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    spec = Path(__file__).with_name("protocol.json")
    protocol = load(spec)["freshness"]
    workspace = args.workspace
    if args.verify:
        receipt = load(workspace / "receipt.json")
        if receipt["protocol_sha256"] != digest(spec) or receipt["windows_sha256"] != digest(workspace / "windows.json"):
            raise ValueError("Freshness protocol or window digest mismatch")
        windows = load(workspace / "windows.json")
    else:
        circle = args.circle.resolve()
        check_checkout(circle, load(spec.parent.parent / "replication/protocol.json")["revisions"]["circle"])
        sys.path.insert(0, str(circle))
        workspace.mkdir(parents=True, exist_ok=False)
        windows = run(protocol)
        put(workspace / "windows.json", windows)
        put(workspace / "receipt.json", {"protocol_sha256": digest(spec), "windows_sha256": digest(workspace / "windows.json")})
    result = {f"{g}/{f}": score([r for r in windows if r["generator"] == g and r["feed"] == f], protocol)
              for g, f in sorted({(r["generator"], r["feed"]) for r in windows})}
    if args.verify:
        if load(workspace / "result.json") != result:
            raise ValueError("Freshness result did not replay")
    else:
        put(workspace / "result.json", result)
        print(json.dumps(result, indent=2))
