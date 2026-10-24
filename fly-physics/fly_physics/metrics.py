"""How far FlyBody's physical body followed the plan.

Both paths are compared in the frame the plan uses, FlyBody's at the start:
x along the heading at the start, y to the fly's left, z up from the floor,
centimetres. The physical path is taken from where the thorax stood when the
plan began (after settling) and turned by the heading it had then, so a fly
that settled a little off its spawn is not counted as off its path.

Speeds and turn rates are averaged over the steady part of the plan (from
`STEADY_FROM_S`, after the walking speed's ramp from rest), and measured on the
thorax sampled every 20 ms, so the body's sway within a step does not count as
distance. A metric that does not apply (a speed ratio while the plan stands
still) is None, never zero.
"""

from __future__ import annotations

import math
from dataclasses import replace

import numpy as np

from .replay import Recording
from .trace import CONTROL_DT_S, Trace

STEADY_FROM_S = 0.5
EVERY = 10  # samples: 20 ms
# A fall: the thorax tipped more than this from upright, or no claw on the ground this long.
FELL_TILT_DEG = 60.0
FELL_DETACHED_S = 0.1


def _yaw(R: np.ndarray) -> np.ndarray:
    return np.arctan2(R[..., 1, 0], R[..., 0, 0])


def physical_path(rec: Recording) -> tuple[np.ndarray, np.ndarray]:
    """Thorax x, y, z (cm) in the plan's frame, and the heading turned since the start (rad)."""
    yaw = np.unwrap(_yaw(rec.xmat))
    c, s = math.cos(-yaw[0]), math.sin(-yaw[0])
    d = rec.thorax - rec.thorax[0]
    xy = np.stack([c * d[:, 0] - s * d[:, 1], s * d[:, 0] + c * d[:, 1], rec.thorax[:, 2]], axis=1)
    return xy, yaw - yaw[0]


def _path_length(xy: np.ndarray) -> float:
    pts = xy[::EVERY, :2]
    return float(np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1)))


def _runs(flags: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive (start, end) of each run of True."""
    out, k, n = [], 0, flags.shape[0]
    while k < n:
        if flags[k]:
            e = k
            while e + 1 < n and flags[e + 1]:
                e += 1
            out.append((k, e))
            k = e + 1
        else:
            k += 1
    return out


def _r(x: float | None, digits: int = 4) -> float | None:
    return None if x is None or not math.isfinite(x) else round(float(x), digits)


def fall_index(rec: Recording) -> int | None:
    """The first sample of a fall: tipped past FELL_TILT_DEG, or the start of a
    stretch longer than FELL_DETACHED_S with no claw on the ground. None if it never fell."""
    tilt = np.degrees(np.arccos(np.clip(rec.xmat[:, 2, 2], -1, 1)))
    over = np.nonzero(tilt > FELL_TILT_DEG)[0]
    candidates = [int(over[0])] if over.size else []
    need = round(FELL_DETACHED_S / CONTROL_DT_S)
    candidates += [a for a, b in _runs(rec.touch.sum(axis=1) == 0) if b - a + 1 > need][:1]
    return min(candidates) if candidates else None


def _before(rec: Recording, k: int) -> Recording:
    return replace(
        rec,
        t=rec.t[:k],
        thorax=rec.thorax[:k],
        xmat=rec.xmat[:k],
        claws=rec.claws[:k],
        claws_local=rec.claws_local[:k],
        touch=rec.touch[:k],
        body_contact=rec.body_contact[:k],
        joint_error=rec.joint_error[:k],
    )


def compare(trace: Trace, rec: Recording, on_ground: bool = True) -> dict:
    """The run's metrics. After a fall they cover the time before it (`fell_at_s`
    says when), since a tumbling body follows no plan. A run off the ground
    (`on_ground=False`, the suspended diagnostic) has no slip, claw contact or
    fall: those are None."""
    whole = rec
    fall = fall_index(rec) if on_ground else None
    if fall is not None:
        rec = _before(rec, max(fall, 2))
    n = rec.t.shape[0]
    plan = trace.thorax[:n]
    phys, heading = physical_path(rec)
    t = rec.t
    steady = t >= STEADY_FROM_S
    window = float(t[steady][-1] - t[steady][0]) if steady.sum() > EVERY else 0.0

    def rate(xy: np.ndarray) -> float | None:
        return _path_length(xy[steady]) / window if window > 0 else None

    planned_speed = rate(plan[:, :2])
    physical_speed = rate(phys[:, :2])
    planned_turn = (plan[steady][-1, 3] - plan[steady][0, 3]) / window if window > 0 else None
    physical_turn = (heading[steady][-1] - heading[steady][0]) / window if window > 0 else None
    moving = planned_speed is not None and planned_speed >= 0.1
    turning = planned_turn is not None and abs(planned_turn) >= 0.1

    # Distance from each physical position to the planned path (any point on it).
    gap = np.linalg.norm(phys[:, None, :2] - plan[None, ::EVERY, :2], axis=2).min(axis=1)
    same_time = np.linalg.norm(phys[:, :2] - plan[:, :2], axis=1)
    disp_plan = plan[-1, :2] - plan[0, :2]
    disp_phys = phys[-1, :2] - phys[0, :2]
    plan_len = float(np.linalg.norm(disp_plan))

    R = rec.xmat
    pitch = np.degrees(np.arcsin(np.clip(R[:, 2, 0], -1, 1)))  # nose up positive
    roll = np.degrees(np.arctan2(R[:, 2, 1], R[:, 2, 2]))  # right wing down positive
    tilt = np.degrees(np.arccos(np.clip(R[:, 2, 2], -1, 1)))

    stance = trace.stance[:n]
    swing = ~stance
    # Slip: how far each stance claw moved over the ground while its leg was planted,
    # from the sample after touchdown to lift-off, for stances of at least 10 ms.
    slips = []
    for leg in range(6):
        for a, b in _runs(stance[:, leg]):
            if b - a >= 5 and t[a] >= 0.1:
                slips.append(
                    float(np.linalg.norm(rec.claws[b, leg, :2] - rec.claws[a + 1, leg, :2]))
                )
    slips_mm = np.array(slips) * 10
    claw_err = np.linalg.norm(rec.claws_local - trace.claws[:n], axis=2)
    down = rec.touch.sum(axis=1)
    detached = max(
        ((b - a + 1) * CONTROL_DT_S for a, b in _runs(whole.touch.sum(axis=1) == 0)), default=0.0
    )
    body_contact_s = float(whole.body_contact.sum()) * CONTROL_DT_S

    out = {
        "plan_duration_s": _r(float(trace.t[-1]), 3),
        "simulated_s": _r(float(whole.t[-1]), 3),
        "analysed_s": _r(float(t[-1]), 3),
        "terminated_at_s": rec.terminated_at_s,
        "planned_speed_cms": _r(planned_speed),
        "physical_speed_cms": _r(physical_speed),
        "speed_ratio": _r(physical_speed / planned_speed)
        if moving and physical_speed is not None
        else None,
        "planned_displacement_cm": _r(plan_len),
        "physical_displacement_cm": _r(float(np.linalg.norm(disp_phys))),
        "progress_ratio": _r(float(disp_phys @ disp_plan) / plan_len**2)
        if plan_len >= 0.1
        else None,
        "planned_turn_rate_dps": _r(math.degrees(planned_turn))
        if planned_turn is not None
        else None,
        "physical_turn_rate_dps": _r(math.degrees(physical_turn))
        if physical_turn is not None
        else None,
        "turn_ratio": _r(physical_turn / planned_turn)
        if turning and physical_turn is not None
        else None,
        "planned_heading_change_deg": _r(math.degrees(plan[-1, 3])),
        "physical_heading_change_deg": _r(math.degrees(heading[-1])),
        "heading_drift_deg": _r(math.degrees(heading[-1] - plan[-1, 3])),
        "position_error_final_cm": _r(float(same_time[-1])),
        "path_deviation_final_cm": _r(float(gap[-1])),
        "path_deviation_max_cm": _r(float(gap.max())),
        "planned_height_cm": _r(float(plan[0, 2]), 5),
        "height_mean_cm": _r(float(phys[:, 2].mean()), 5),
        "height_min_cm": _r(float(phys[:, 2].min()), 5),
        "height_max_cm": _r(float(phys[:, 2].max()), 5),
        "pitch_mean_deg": _r(float(pitch.mean()), 2),
        "pitch_max_abs_deg": _r(float(np.abs(pitch).max()), 2),
        "roll_max_abs_deg": _r(float(np.abs(roll).max()), 2),
        "tilt_max_deg": _r(float(tilt.max()), 2),
        "claws_down_mean": _r(float(down.mean()), 3),
        "stance_claws_touching": _r(float(rec.touch[stance].mean()), 3) if stance.any() else None,
        "swing_claws_touching": _r(float(rec.touch[swing].mean()), 3) if swing.any() else None,
        "stance_slip_mean_mm": _r(float(slips_mm.mean())) if slips else None,
        "stance_slip_p95_mm": _r(float(np.percentile(slips_mm, 95))) if slips else None,
        "stance_slip_max_mm": _r(float(slips_mm.max())) if slips else None,
        "stances_measured": len(slips),
        "claw_error_mean_mm": _r(float(claw_err.mean()) * 10),
        "joint_error_mean_rad": _r(float(rec.joint_error.mean())),
        "body_contact_s": _r(body_contact_s, 3),
        "body_parts_touching_s": {
            part: _r(count * CONTROL_DT_S, 3)
            for part, count in sorted(rec.body_parts_touching.items())
        },
        "detached_max_s": _r(detached, 3),
        "fell": fall is not None,
        "fell_at_s": _r(float(whole.t[fall]), 3) if fall is not None else None,
    }
    if not on_ground:
        for key in (
            "stance_claws_touching",
            "swing_claws_touching",
            "stance_slip_mean_mm",
            "stance_slip_p95_mm",
            "stance_slip_max_mm",
            "detached_max_s",
            "fell",
            "fell_at_s",
        ):
            out[key] = None
        out["stances_measured"] = 0
    return out


def series(trace: Trace, rec: Recording) -> dict:
    """Every 20 ms: the plan and the physical body side by side, for plotting."""
    n = rec.t.shape[0]
    phys, heading = physical_path(rec)
    R = rec.xmat
    k = slice(0, n, EVERY)
    rnd = lambda a, d=5: np.round(a, d).tolist()
    return {
        "t": rnd(rec.t[k], 3),
        "planned_x_cm": rnd(trace.thorax[:n][k, 0]),
        "planned_y_cm": rnd(trace.thorax[:n][k, 1]),
        "planned_heading_rad": rnd(trace.thorax[:n][k, 3]),
        "x_cm": rnd(phys[k, 0]),
        "y_cm": rnd(phys[k, 1]),
        "z_cm": rnd(phys[k, 2]),
        "heading_rad": rnd(heading[k]),
        "pitch_deg": rnd(np.degrees(np.arcsin(np.clip(R[k, 2, 0], -1, 1))), 2),
        "roll_deg": rnd(np.degrees(np.arctan2(R[k, 2, 1], R[k, 2, 2])), 2),
        "claws_down": rec.touch[k].sum(axis=1).tolist(),
    }
