"""Checks against FlyBody's MuJoCo model; skipped without the verified checkout or a trace.

node scripts/run-ts.mjs scripts/fly-physics-trace.ts --scenario walk-2cms
python -m fly_physics setup
"""

from dataclasses import replace

import numpy as np
import pytest
from fly_physics import source
from fly_physics.replay import Options, replay
from fly_physics.trace import LEGS, load

TRACE = source.REPO_ROOT / ".fly-physics" / "traces" / "walk-2cms.json"

try:
    source.import_flybody()
    FLYBODY = None
except (source.FlyBodySourceError, ImportError) as e:  # pragma: no cover - environment dependent
    FLYBODY = str(e)

needs_flybody = pytest.mark.skipif(FLYBODY is not None, reason=f"FlyBody unavailable: {FLYBODY}")
needs_trace = pytest.mark.skipif(not TRACE.exists(), reason=f"no trace at {TRACE}")


def _short(tr, seconds: float):
    """The first `seconds` of a plan."""
    k = round(seconds / 0.002) + 1
    return replace(
        tr,
        t=tr.t[:k],
        thorax=tr.thorax[:k],
        stance=tr.stance[:k],
        targets=tr.targets[:k],
        claws=tr.claws[:k],
        walk_speed_cms=tr.walk_speed_cms[:k],
        yaw_rate=tr.yaw_rate[:k],
    )


@needs_flybody
@needs_trace
def test_mujoco_puts_the_claws_where_pose_ts_does():
    """The plan's joint angles, through FlyBody's MJCF, reach the claw positions the browser drew."""
    import mujoco
    from flybody.fly_envs import template_task

    tr = load(TRACE)
    env = template_task(random_state=np.random.RandomState(0), time_limit=1.0)
    env.reset()
    ph = env.physics
    m, d = ph.model.ptr, ph.data.ptr
    worst = 0.0
    for k in (0, 101, 437, tr.t.shape[0] - 1):
        for j, name in enumerate(tr.actuators):
            if not name.startswith("tarsus2"):
                ph.named.data.qpos["walker/" + name] = tr.targets[k, j]
        mujoco.mj_kinematics(m, d)
        p = ph.named.data.xpos["walker/thorax"]
        R = ph.named.data.xmat["walker/thorax"].reshape(3, 3)
        for i, leg in enumerate(LEGS):
            local = R.T @ (ph.named.data.xpos[f"walker/claw_{leg}"] - p)
            worst = max(worst, float(np.abs(local - tr.claws[k, i]).max()))
    assert worst < 1e-6  # cm


@needs_flybody
def test_the_compiled_filters_are_read_from_the_model():
    """template_task's joint filter is in the compiled model; its adhesion filter is not.

    Pinned for dm_control 1.0.50 and MuJoCo 3.17.0: if a version changes either,
    this fails, and the README's account of the compiled model must be checked."""
    from fly_physics.replay import _actuator_lags, _lead_steps
    from flybody.fly_envs import template_task

    env = template_task(random_state=np.random.RandomState(0), time_limit=1.0)
    env.reset()
    lags = _actuator_lags(env.physics.model.ptr)
    assert lags["joint_filter_s"] == pytest.approx(0.01)
    assert lags["adhesion_filter_s"] == 0.0
    assert 0.009 < lags["joint_lag_s"] < 0.02
    steps, seconds = _lead_steps("model", lags["joint_filter_s"] + lags["joint_lag_s"])
    assert steps == 12 and seconds == pytest.approx(0.024)


@needs_flybody
@needs_trace
def test_a_replay_is_deterministic_and_stands():
    tr = _short(load(TRACE), 0.1)
    options = Options(settle_s=0.05)
    a, b = replay(tr, options), replay(tr, options)
    assert a.t.shape == tr.t.shape and a.terminated_at_s is None
    np.testing.assert_array_equal(a.thorax, b.thorax)
    np.testing.assert_array_equal(a.claws, b.claws)
    # Standing on its claws, near the plan's height, after settling.
    assert a.touch[0].sum() >= 4
    assert abs(a.thorax[0, 2] - tr.thorax[0, 2]) < 0.02
    assert not a.body_contact[0]
