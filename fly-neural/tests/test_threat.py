import json
import types
from pathlib import Path

import numpy as np
import pytest

from fly_neural import sensory, threat

CFG = json.loads((Path(__file__).parent.parent / "experiments" / "threat-v783.json").read_text(encoding="utf-8"))


def test_batteries_have_clean_ground_truth_and_are_deterministic():
    dev, held = threat.battery(CFG, "dev"), threat.battery(CFG, "heldout")
    assert dev["sha256"] == threat.battery(CFG, "dev")["sha256"]
    for b in (dev, held):
        for s in b["stimuli"]:
            assert s["threat"] == (s["kind"] in ("approach", "accelerating")), s
            assert s["threat"] or s["min_surface_m"] >= CFG["ground_truth"]["harmless_min_surface_m"]
            assert not s["threat"] or s["t_on"] < s["t_collision"] <= s["t_off"]
    assert sum(s["threat"] for s in dev["stimuli"]) == 12
    # Held-out shows contrast and trajectory kinds development never does.
    assert {s["contrast"] for s in held["stimuli"]} - {s["contrast"] for s in dev["stimuli"]} == {0.25}
    assert {s["kind"] for s in held["stimuli"]} - {s["kind"] for s in dev["stimuli"]} == {"accelerating", "approach_stop", "zigzag"}


def test_a_stimulus_between_threat_and_harmless_is_refused():
    cfg = json.loads(json.dumps(CFG))
    cfg["batteries"]["dev"]["stimuli"] = [{"kind": "lateral", "radius": 0.05, "speed": 1.0, "miss": 0.08, "half_length": 0.5, "azimuth_deg": 0, "elevation_deg": 0, "contrast": 1.0}]
    with pytest.raises(ValueError, match="neither a threat nor harmless"):
        threat.battery(cfg, "dev")


def test_v2_mapping_answers_only_expansion_and_scales_with_contrast():
    base = types.SimpleNamespace(rates=lambda obs: sensory.Mapper.rates(None, obs))
    obs = lambda size, exp: sensory.observation({"looming": {"sizeDeg": size, "expansionDegS": exp, "bearing": 0.5}, "airflow": 0, "airflowFrom": None, "odour": 0, "onFood": False})
    recede = threat.v2_rates(base, obs(60, -300), 1.0, 20, 5, 200)
    assert recede["lplc2_left"] == recede["lc4_left"] == 0.0
    still = threat.v2_rates(base, obs(60, 0), 1.0, 20, 5, 200)
    assert still["lplc2_left"] == 0.0
    big = threat.v2_rates(base, obs(60, 300), 1.0, 20, 5, 200)
    small = threat.v2_rates(base, obs(5, 300), 1.0, 20, 5, 200)
    half = threat.v2_rates(base, obs(60, 300), 0.5, 20, 5, 200)
    assert big["lplc2_left"] > 199 and small["lplc2_left"] < 10 and np.isclose(half["lplc2_left"], big["lplc2_left"] / 2)
    assert big["lplc2_right"] == 0.0
    # v1 answers a receding or static object as strongly as an approaching one of the same size.
    assert base.rates(obs(60, -300))["lplc2_left"] == base.rates(obs(60, 300))["lplc2_left"] == 200.0


def test_integrated_readout_needs_sustained_spikes_and_is_refractory():
    # tau 30 ms over 10 ms samples: each sample keeps exp(-1/3) = 0.72 of the count.
    gf = [1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1]
    out = threat.readout_integrated(gf, k=2, tau_ms=30, refractory_s=0.05, sample_s=0.01)
    # 2.33 at sample 7; the count passes 2 again at 11, inside the refractory 50 ms, so the next is at 12.
    assert out.tolist() == [False] * 7 + [True] + [False] * 4 + [True, False]
    assert threat.readout_any(gf).sum() == 9
    assert not threat.readout_integrated([1, 0, 0, 1], k=2, tau_ms=10, refractory_s=0, sample_s=0.01).any()


def test_heuristics_read_only_the_fly_view():
    rows = [{"obs": {"looming": {"sizeDeg": s, "expansionDegS": e, "bearing": 0}}} for s, e in ((50, 100), (50, -100), (8, 100), (30, 300))] + [{"obs": {"looming": None}}]
    assert threat.heuristic(rows, "size", 40).tolist() == [True, False, False, False, False]
    assert threat.heuristic(rows, "ttc", 0.1).tolist() == [False, False, True, True, False]


def test_scoring_counts_hits_misses_false_alarms_and_lead():
    bat = {
        "duration_s": 60.0,
        "stimuli": [
            {"index": 0, "kind": "approach", "threat": True, "t_on": 1.0, "t_off": 2.0, "t_collision": 2.0},
            {"index": 1, "kind": "lateral", "threat": False, "t_on": 4.0, "t_off": 5.0, "t_collision": None},
            {"index": 2, "kind": "approach", "threat": True, "t_on": 7.0, "t_off": 7.5, "t_collision": 7.5},
        ],
    }
    rows = [{"t": round(t, 2), "obs": {"looming": {"sizeDeg": 10, "expansionDegS": 1, "bearing": 0} if (1.1 <= t <= 2 or 4 <= t <= 5 or 7 <= t <= 7.5) else None}} for t in np.arange(0, 60, 0.01)]
    flags = np.zeros(len(rows), dtype=bool)
    for t in (1.5, 1.6, 4.2, 30.0):
        flags[int(round(t / 0.01))] = True
    ts = np.array([r["t"] for r in rows])
    dec = threat.onsets(flags, ts, 0.5)
    assert dec == [1.5, 4.2, 30.0]
    m = threat.score(dec, bat, rows, 0.5)
    assert (m["hits"], m["misses"], m["false_alarms"], m["false_alarms_with_nothing_showing"]) == (1, 1, 2, 1)
    assert m["false_alarms_per_min"] == 2.0 and np.isclose(m["median_lead_s"], 0.5)
    assert np.isclose(m["precision"], 1 / 3) and m["recall"] == 0.5
    per = {p["index"]: p for p in m["per_stimulus"]}
    assert per[0]["escaped"] and np.isclose(per[0]["latency_from_visible_s"], 0.4) and not per[2]["escaped"] and per[1]["false_alarms"] == 1


def test_samples_keep_the_last_view_and_any_echo_escape():
    recs = [{"t": 0.001, "obs": {"a": 1}, "echo": {"escape": True}}, {"t": 0.004, "obs": {"a": 2}}, {"t": 0.012, "obs": {"a": 3}}]
    rows = threat.samples(recs, 0.01)
    assert [r["obs"]["a"] for r in rows] == [2, 3] and [r["echo_escape"] for r in rows] == [True, False]


def test_selection_prefers_the_recall_floor_then_f1_then_lead():
    m = lambda r, f, lead: {"recall": r, "f1": f, "median_lead_s": lead}
    scored = [({"name": "a"}, m(0.7, 0.9, 0.1)), ({"name": "b"}, m(0.8, 0.6, 0.1)), ({"name": "c"}, m(0.9, 0.6, 0.2))]
    best, _, met = threat._pick(scored)
    assert best["name"] == "c" and met
    best, _, met = threat._pick([scored[0]])
    assert best["name"] == "a" and not met


def test_candidates_cover_every_mapping_and_readout():
    names = [c["name"] for c in threat.candidates(CFG)]
    assert names[0] == "v1/any" and len(names) == 3 * (1 + 6 * 3) and len(set(names)) == len(names)
