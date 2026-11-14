"""Causal PPG measurements for the registered motion ablations."""

from bisect import bisect_left, bisect_right
from dataclasses import replace
import math
import sys

import numpy as np


def truth_rate(beats):
    if len(beats) < 2 or any(a >= b for a, b in zip(beats, beats[1:])):
        raise ValueError("Expected at least two ordered reference beats")
    return round(60 * (len(beats) - 1) / (beats[-1] - beats[0]), 6)


def available_rate(raw, ev, config, episodes):
    from models.physiology.pipeline import detect_beats

    ppg = raw.streams["ppg"].until(ev.decision_time_us).window(ev.window_start_us, ev.input_cutoff_us)
    detected = detect_beats(ppg, raw.descriptors["ppg"], episodes)
    start = ev.input_cutoff_us / 1e6 - config.hr_window_s
    valid = detected["ibi_valid"] & (detected["ibi_end_s"] >= start)
    intervals = detected["ibi_s"][valid]
    return (
        round(float(60 / np.mean(intervals)), 6) if len(intervals) >= 3 else None,
        round(min(1.0, float(sum(intervals)) / config.hr_window_s), 6),
    )


def observations(run, split, scenario, seed, generator, alternate=False):
    clock = run.rig.clock
    config = run.config.controller
    truth_beats = generator["beats"]
    rows = []
    for ev in run.evaluations:
        cutoff = float(clock.to_true_s(ev.input_cutoff_us))
        if not 230 <= cutoff < 330:
            continue
        first = bisect_left(truth_beats, float(clock.to_true_s(ev.window_start_us)))
        hr_start = float(clock.to_true_s(ev.input_cutoff_us - round(config.hr_window_s * 1e6)))
        first_end = max(first + 1, bisect_left(truth_beats, hr_start))
        beats = truth_beats[first_end - 1:bisect_right(truth_beats, cutoff)]
        raw = generator["raw"]
        if alternate:
            from models.physiology.pipeline import analyze_motion

            imu = raw.streams["imu"].until(ev.decision_time_us).window(ev.window_start_us, ev.input_cutoff_us)
            episodes = analyze_motion(imu, raw.descriptors["imu"])["episodes"]
            estimate, coverage = available_rate(raw, ev, config, episodes)
        else:
            estimate, coverage = ev.features.get("hr_bpm"), ev.features["beat_coverage"]
        unmasked, unmasked_coverage = available_rate(raw, ev, config, [])
        ppg = raw.streams["ppg"].until(ev.decision_time_us)
        fresh_ppg = bool(len(ppg.window(ev.input_cutoff_us - 500_000, ev.input_cutoff_us)))
        rows.append({
            "id": f"{split}-{scenario}-{seed}-{ev.input_cutoff_us}",
            "sequence": f"seed-{seed}", "split": split, "scenario": scenario,
            "estimate_bpm": estimate, "beat_coverage": coverage,
            "truth_bpm": truth_rate(beats), "truth_beat_seconds": beats,
            "fresh_ppg": fresh_ppg,
            "unmasked_estimate_bpm": unmasked, "unmasked_coverage": unmasked_coverage,
        })
    return rows


def independent_ppg(run, seed, scenario):
    """An independent beat schedule and optical waveform on CIRCLE's acquisition grid."""
    rng = np.random.default_rng(seed + 200_000)
    beats = [0.15]
    while beats[-1] < 360:
        t = beats[-1]
        bpm = 73 + 7 * math.sin(t / 58) + 2 * math.sin(2 * math.pi * t / 4.8)
        beats.append(t + 60 / bpm + float(rng.normal(0, 0.008)))
    raw = run.raw
    ppg = raw.streams["ppg"]
    t = run.rig.clock.to_true_s(ppg.device_time_us)
    indices = np.searchsorted(beats, t, side="right")
    before = np.asarray(beats)[np.clip(indices - 1, 0, len(beats) - 1)]
    after = np.asarray(beats)[np.clip(indices, 0, len(beats) - 1)]
    pulse = np.exp(-abs((t - before) / 0.11) ** 1.5) + np.exp(-abs((t - after) / 0.07) ** 1.5)
    pulse += 0.21 * np.exp(-((t - before - 0.22) / 0.065) ** 2)
    ir_noise = rng.normal(0, 12, len(t))
    red_noise = rng.normal(0, 12, len(t))
    artifact = np.zeros_like(t)
    if scenario != "clean":
        for start, stop, hz in ((236, 258, 1.6), (268, 282, 2.1)):
            active = (t >= start) & (t < stop)
            local = t[active] - start
            phase = float(rng.uniform(0, 2 * math.pi))
            envelope = np.sin(np.pi * local / (stop - start)) ** 2
            artifact[active] += 1800 * envelope * np.sin(2 * np.pi * hz * local + phase)
    contact = np.where((t >= 245) & (t < 267), 0.22, 1.0) if scenario == "motion_contact_loss" else 1.0
    ir = contact * (96000 - 1500 * pulse + artifact) + ir_noise
    red = contact * (71000 - 900 * pulse + 0.7 * artifact) + red_noise
    stream = replace(ppg, columns={"ir_counts": np.rint(ir).astype(int), "red_counts": np.rint(red).astype(int)})
    return {"beats": beats, "raw": replace(raw, streams={**raw.streams, "ppg": stream})}


def acquire(circle, protocol):
    sys.path.insert(0, str(circle))
    try:
        from models.physiology.experiment import run_session
        from models.physiology.scenarios import SCENARIOS

        rows = {name: [] for name in protocol["generators"]}
        design = [("calibration", "clean", protocol["calibration_seeds"])]
        design += [("test", family, protocol["test_seeds"]) for family in protocol["test_families"]]
        for split, scenario, seeds in design:
            for seed in seeds:
                template = "motion_heavy" if scenario == "motion_contact_loss" else scenario
                config = replace(SCENARIOS[template].configure(seed), actuate=False)
                if scenario == "motion_contact_loss":
                    config = replace(config, rig=replace(config.rig, ppg_coupling_loss=((245.0, 267.0, 0.22),)))
                original = run_session(config)
                source = {"beats": sorted(float(b["systolic_s"]) for b in original.twin.truth()["beats"]),
                          "raw": original.raw}
                rows["circle"].extend(observations(original, split, scenario, seed, source))
                alt = independent_ppg(original, seed, scenario)
                rows["independent_pulse"].extend(observations(original, split, scenario, seed, alt, alternate=True))
        return rows
    finally:
        sys.path.remove(str(circle))
