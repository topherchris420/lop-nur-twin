"""Fast checks that need neither MuJoCo's FlyBody nor a trace from the browser fly."""

import hashlib
import json
import math
from dataclasses import replace

import numpy as np
import pytest
from fly_physics import source
from fly_physics.metrics import compare
from fly_physics.replay import Incline, Options, Push, Recording
from fly_physics.scenarios import PERTURBATIONS, PLANS, runs
from fly_physics.trace import TraceError, load


def test_the_pin_is_the_importers():
    pin = source.pinned()
    manifest = json.loads(source.MANIFEST.read_text())
    assert pin["commit"] == manifest["commit"] and len(pin["commit"]) == 40
    assert pin["url"] == "https://github.com/TuragaLab/flybody"
    assert any(i["path"] == "flybody/fruitfly/assets/fruitfly.xml" for i in pin["inputs"])


def test_line_endings_match_only_as_text():
    lf = b"<mujoco>\n  <body/>\n</mujoco>\n"
    crlf = lf.replace(b"\n", b"\r\n")
    assert source.match(lf, hashlib.sha256(lf).hexdigest()) == "exact"
    assert source.match(lf, hashlib.sha256(crlf).hexdigest()) == "crlf"
    assert source.match(crlf, hashlib.sha256(crlf).hexdigest()) == "exact"
    assert source.match(lf + b"x", hashlib.sha256(crlf).hexdigest()) is None
    binary = b"\0\n\1"
    assert source.match(binary, hashlib.sha256(binary.replace(b"\n", b"\r\n")).hexdigest()) is None


def test_a_trace_loads_and_bad_ones_are_refused(trace_file):
    tr = load(trace_file)
    assert tr.t.shape == (501,) and tr.targets.shape == (501, 48) and tr.claws.shape == (501, 6, 3)
    assert tr.file_sha256 == hashlib.sha256(trace_file.read_bytes()).hexdigest()
    raw = json.loads(trace_file.read_text())
    for change in (
        lambda r: r.update(schema="fly-physics-trace/v0"),
        lambda r: r["fly"].update(gate_refusals=1),
        lambda r: r["samples"]["targets"].pop(),
        lambda r: r["samples"]["stance"].__setitem__(3, [2] * 6),
        lambda r: r["samples"]["t"].__setitem__(5, 0.5),
        lambda r: r.update(legs=list(reversed(r["legs"]))),
    ):
        bad = json.loads(json.dumps(raw))
        change(bad)
        trace_file.write_text(json.dumps(bad))
        with pytest.raises(TraceError):
            load(trace_file)
    trace_file.write_text(json.dumps(raw).replace("0.002", "0.0021", 1))
    with pytest.raises(TraceError):
        load(trace_file)


def _recording(tr, offset=(0.0, 0.0), yaw0=0.0, gain=1.0) -> Recording:
    """The plan executed exactly (times `gain` in distance), from `offset`, facing `yaw0`."""
    n = tr.t.shape[0]
    c, s = math.cos(yaw0), math.sin(yaw0)
    x, y = tr.thorax[:, 0] * gain, tr.thorax[:, 1] * gain
    R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    return Recording(
        t=tr.t.copy(),
        thorax=np.stack(
            [offset[0] + c * x - s * y, offset[1] + s * x + c * y, tr.thorax[:, 2]], axis=1
        ),
        xmat=np.repeat(R[None], n, axis=0),
        claws=np.zeros((n, 6, 3)),
        claws_local=tr.claws.copy(),
        touch=np.ones((n, 6), dtype=bool),
        body_contact=np.zeros(n, dtype=bool),
        joint_error=np.zeros(n),
        terminated_at_s=None,
    )


def _with_a_swing(trace_file):
    """Every leg swings from 80 to 100 ms, then stands to the end."""
    raw = json.loads(trace_file.read_text())
    for k in range(40, 50):
        raw["samples"]["stance"][k] = [0] * 6
    trace_file.write_text(json.dumps(raw))
    return load(trace_file)


def test_a_perfect_execution_scores_as_one(trace_file):
    tr = _with_a_swing(trace_file)
    # Starting elsewhere and facing elsewhere is not an error: paths are compared from the start.
    m = compare(tr, _recording(tr, offset=(3.0, -2.0), yaw0=1.1))
    assert m["speed_ratio"] == pytest.approx(1.0, abs=1e-6)
    assert m["progress_ratio"] == pytest.approx(1.0, abs=1e-6)
    assert m["heading_drift_deg"] == pytest.approx(0.0, abs=1e-6)
    assert m["position_error_final_cm"] == pytest.approx(0.0, abs=1e-6)
    assert m["claw_error_mean_mm"] == pytest.approx(0.0, abs=1e-9)
    assert m["stances_measured"] == 6 and m["stance_slip_max_mm"] == 0.0
    assert m["fell"] is False


def test_a_claw_dragged_in_stance_is_slip(trace_file):
    tr = _with_a_swing(trace_file)
    rec = _recording(tr)
    # The first leg's claw slides 0.3 mm forward over its stance from 100 ms on.
    rec.claws[50:, 0, 0] = np.linspace(0.0, 0.03, tr.t.shape[0] - 50)
    m = compare(tr, rec)
    assert m["stance_slip_max_mm"] == pytest.approx(0.3 * (1 - 1 / (tr.t.shape[0] - 51)), abs=1e-3)
    assert m["stance_slip_mean_mm"] == pytest.approx(m["stance_slip_max_mm"] / 6, abs=1e-3)


def test_a_slower_body_scores_its_share(trace_file):
    tr = load(trace_file)
    m = compare(tr, _recording(tr, gain=0.25))
    assert m["speed_ratio"] == pytest.approx(0.25, abs=1e-3)
    assert m["progress_ratio"] == pytest.approx(0.25, abs=1e-3)
    assert m["position_error_final_cm"] == pytest.approx(0.75 * tr.thorax[-1, 0], abs=1e-6)


def test_a_fall_is_dated_and_ends_the_comparison(trace_file):
    tr = load(trace_file)
    rec = _recording(tr)
    # At 0.8 s every claw lets go and the body flies off backwards, tumbling.
    k = 400
    rec.touch[k:] = False
    rec.thorax[k:, 0] -= np.linspace(0.0, 50.0, tr.t.shape[0] - k)
    m = compare(tr, rec)
    assert m["fell"] is True and m["fell_at_s"] == pytest.approx(0.8)
    assert m["analysed_s"] == pytest.approx(0.798)
    # Up to the fall the body followed the plan exactly.
    assert m["speed_ratio"] == pytest.approx(1.0, abs=1e-6)
    assert m["detached_max_s"] == pytest.approx(0.202, abs=1e-6)


def test_off_the_ground_metrics_are_unknown_not_zero(trace_file):
    tr = load(trace_file)
    m = compare(tr, _recording(tr), on_ground=False)
    assert (
        m["fell"] is None and m["stance_slip_mean_mm"] is None and m["swing_claws_touching"] is None
    )


def test_the_run_matrix():
    rs = runs()
    ids = [r["id"] for r in rs]
    assert len(ids) == len(set(ids))
    assert {r["plan"] for r in rs} == set(PLANS)
    assert set(PERTURBATIONS) == {r["perturbation"] for r in rs} - {None}
    for r in rs:
        assert isinstance(r["options"], Options)
        r["options"].validate()
        # Every departure from template_task is a named option, recorded as such.
        assert set(r["options"].describe()) == set(Options().describe())


def test_every_situation_is_described_from_its_recorded_options():
    from fly_physics.report import _situation, readme

    for r in runs():
        if r["perturbation"] not in (None, "suspended"):
            text = _situation(r["perturbation"], r["options"].describe())
            assert text.startswith(f"- **{r['perturbation']}**: ") and text.endswith(".")
            assert len(text) > len(r["perturbation"]) + 12
    assert "No results yet" in readme([])
    mixed = [
        {"code": {"commit": "a" * 40, "dirty": False}},
        {"code": {"commit": "b" * 40, "dirty": False}},
    ]
    with pytest.raises(ValueError):
        readme(mixed)


@pytest.mark.parametrize(
    "change",
    [
        {"suspended": True, "incline": Incline(10.0)},
        {"suspended": True, "push": Push(1.0, 90.0, 0.5, 0.02)},
        {"adhesion": "always"},
        {"target_lead_s": 0.5},
        {"adhesion_lead_s": "early"},
        {"friction": 0.0},
        {"settle_s": -1.0},
    ],
)
def test_options_that_cannot_describe_a_run_are_refused(change):
    with pytest.raises(ValueError):
        replace(Options(), **change).validate()
