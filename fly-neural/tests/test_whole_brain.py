"""whole-brain/v2: the small-object channel and the trailing descending readouts. Synthetic: no connectome."""

import io
import json

import numpy as np
import pytest

from fly_neural import sensory, shadow
from fly_neural.populations import CITE, POPULATIONS

V1_SENSABLE = {"looming", "airflow", "airflowFrom", "odour", "onFood"}


def test_v1_description_is_unchanged():
    d = sensory.describe_mapping()
    assert set(d["sensable_fields"]) == V1_SENSABLE
    assert [c["key"] for c in d["channels"]] == ["looming size", "looming expansion", "airflow", "food odour", "food contact"]
    assert set(d["readouts"]) == {"feed", "escape"}
    assert "mapping" not in d


def test_v2_adds_the_other_fly_and_the_descending_commands():
    d = sensory.describe_mapping("whole-brain/v2")
    assert d["mapping"] == "whole-brain/v2"
    assert d["channels"][-1]["key"] == "small moving object"
    assert set(d["readouts"]) == {"feed", "escape", "walk", "backward", "groom", "land", "turn"}
    for ro in d["readouts"].values():
        assert ro["cite"] and all(isinstance(c, str) for c in ro["cite"])
        for p in ro["populations"]:
            assert p in POPULATIONS
    assert all(k in CITE for ch in sensory.CHANNELS_V2 for k in ch.cite)
    with pytest.raises(sensory.ObservationError):
        sensory.check_mapping("v3")


def test_small_object_is_sensable_and_nothing_more():
    ok = sensory.observation({"smallObject": {"sizeDeg": 8, "speedDegS": -60, "bearing": 0.3}})
    assert ok["smallObject"] == {"sizeDeg": 8.0, "speedDegS": -60.0, "bearing": 0.3}
    assert "smallObject" not in sensory.observation({"airflow": 0.1})
    for bad in (
        {"smallObject": {"sizeDeg": 8, "speedDegS": 1, "bearing": 0.3, "id": "bridge"}},
        {"smallObject": {"sizeDeg": 8, "speedDegS": 1, "bearing": 0.3, "distance": 0.02}},
        {"smallObject": {"sizeDeg": 8, "bearing": 0.3}},
        {"smallObject": [8, 1, 0.3]},
    ):
        with pytest.raises(sensory.ObservationError):
            sensory.observation(bad)


def test_small_object_rate_prefers_small_moving_things():
    rate = sensory.small_object_rate
    assert rate(None) == 0
    assert rate({"sizeDeg": 8, "speedDegS": 0, "bearing": 0}) == 0  # still: nothing for LC11 to see move
    assert rate({"sizeDeg": 8, "speedDegS": 200, "bearing": 0}) == pytest.approx(150)
    assert rate({"sizeDeg": 8, "speedDegS": -50, "bearing": 0}) == pytest.approx(75)
    assert rate({"sizeDeg": 22.5, "speedDegS": 200, "bearing": 0}) == pytest.approx(75)
    assert rate({"sizeDeg": 30, "speedDegS": 200, "bearing": 0}) == 0  # too large: a looming thing, not an object


class _V1Only(sensory.Mapper):
    def __init__(self, mapping):  # no connectome: only the rate logic is under test
        self.mapping = mapping
        self.idx = {}


def test_v1_refuses_the_v2_input_and_v2_drives_the_object_side():
    obs = sensory.observation({"smallObject": {"sizeDeg": 6, "speedDegS": 100, "bearing": -0.2}})
    with pytest.raises(sensory.ObservationError):
        _V1Only("v1").rates(obs)
    r = _V1Only("whole-brain/v2").rates(obs)
    assert r["lc11_right"] == r["lc10a_right"] == pytest.approx(150)
    assert r["lc11_left"] == r["lc10a_left"] == 0
    assert list(r)[: len(_V1Only("v1").rates(sensory.observation({})))] == list(_V1Only("v1").rates(sensory.observation({})))


def _idx():
    """Toy indices: each readout population its own neurons, and five descending neurons in all."""
    keys = sorted({p for r in sensory.READOUTS_V2.values() for p in r["populations"]})
    idx, k = {}, 0
    for key in keys:
        idx[key] = np.arange(k, k + 2)
        k += 2
    idx["descending_all"] = np.array([idx["dnp09_left"][0], idx["dna02_left"][0], idx["dna02_right"][0], idx["giant_fiber_left"][0], k])
    return idx, k + 1


def test_trailing_window_reads_rates_and_escape_reads_the_newest_step():
    idx, n = _idx()
    tr = sensory.TrailingReadout(idx, window_ms=100)
    counts = np.zeros(n, dtype=np.int64)
    counts[idx["giant_fiber_left"][0]] = 1
    out = tr.update(counts, 10.0)
    assert out["escape"]["predicted"] and out["descending"] == {"active": 1, "of": 5}
    quiet = np.zeros(n, dtype=np.int64)
    out = tr.update(quiet, 10.0)
    assert not out["escape"]["predicted"], "escape is a reflex: one request's window"
    assert out["descending"]["active"] == 1, "the giant fiber's spike is still in the trailing window"
    # DNp09: 4 neurons, one spike each per 10 ms step -> 100 Hz once the window fills; v1's one-step window would flicker.
    walking = np.zeros(n, dtype=np.int64)
    walking[idx["dnp09_left"]] = walking[idx["dnp09_right"]] = 1
    for _ in range(10):
        out = tr.update(walking, 10.0)
    assert out["window_ms"] == pytest.approx(100)
    assert out["walk"]["mean_rate_hz"] == pytest.approx(100) and out["walk"]["predicted"]
    for _ in range(9):
        out = tr.update(quiet, 10.0)
    assert out["walk"]["mean_rate_hz"] == pytest.approx(10) and out["walk"]["predicted"]
    out = tr.update(quiet, 10.0)
    assert not out["walk"]["predicted"]
    assert out["descending"]["active"] == 0


def test_turn_follows_the_more_active_dna02():
    idx, n = _idx()
    tr = sensory.TrailingReadout(idx, window_ms=50)
    c = np.zeros(n, dtype=np.int64)
    c[idx["dna02_left"]] = 1
    for _ in range(5):
        out = tr.update(c, 10.0)
    assert out["turn"]["predicted"] and out["turn"]["direction"] == "left"
    assert out["turn"]["left_hz"] == pytest.approx(100) and out["turn"]["right_hz"] == 0
    c[:] = 0
    c[idx["dna02_right"]] = 1
    for _ in range(5):
        out = tr.update(c, 10.0)
    assert out["turn"]["direction"] == "right"
    with pytest.raises(sensory.ObservationError):
        sensory.TrailingReadout(idx, window_ms=5)


def test_serve_refuses_an_unknown_mapping_before_loading_anything(tmp_path):
    head = {"schema": "fly-neural-shadow/v1", "mode": "neural-experimental", "subject": "research-contact-1", "mapping": "everything"}
    with pytest.raises(sensory.ObservationError):
        shadow.serve(tmp_path / "missing", inp=io.StringIO(json.dumps(head) + "\n"), out=io.StringIO())
