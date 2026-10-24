"""Driving FlyBody's MuJoCo model with the browser fly's walking plan.

The task is FlyBody's own `fly_envs.template_task()`, the empty walking task
it provides for custom controllers: its FruitFly walker on a flat floor, with
FlyBody's walking configuration (position actuators, wings retracted and
disabled, a 0.2 ms physics step and a 2 ms control step). template_task asks
for a 10 ms filter on the joint actuators and a 7 ms filter on the claw
adhesion; what the compiled model actually holds is read back and recorded
(with dm_control 1.0.50 and MuJoCo 3.17.0 the joint filter is there and the
adhesion actuators have no activation dynamics at all). Each control step
sends the plan's joint and tendon targets to the leg actuators, exactly as
FlyBody's own policies send their actions, and switches each claw's adhesion
on while its leg is in stance and off in swing. Head and abdomen are held at
zero.

Nothing about FlyBody's model is changed silently. Everything that departs
from `template_task` (the settling hold before the plan, leading the targets
or the adhesion, an incline, friction, a push, a step in the floor, adhesion
off) is a field of `Options`, and the result records all of them.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

import mujoco
import numpy as np

from .trace import CONTROL_DT_S, LEGS, Trace

LEG_SEGMENTS = ("coxa", "femur", "tibia", "tarsus", "claw")


@dataclass(frozen=True)
class Incline:
    """Gravity turned so the floor is a slope of `deg`, rising toward `toward_deg`
    (0 is the fly's heading at the start, 90 its left). 180 is a ceiling."""

    deg: float
    toward_deg: float = 0.0


@dataclass(frozen=True)
class Push:
    """A force on the thorax, in multiples of the fly's weight, along the floor
    toward `toward_deg` (0 ahead at the start, 90 to the left)."""

    body_weights: float
    toward_deg: float
    start_s: float
    duration_s: float


@dataclass(frozen=True)
class Step:
    """A raised slab in the floor: `height_cm` high, its edge `at_x_cm` ahead of the start."""

    height_cm: float
    at_x_cm: float
    length_cm: float = 10.0
    width_cm: float = 10.0


@dataclass(frozen=True)
class Options:
    """Every way a run departs from FlyBody's template_task defaults."""

    # Hold the plan's first pose with every claw adhering for this long before the
    # plan starts, so the fly comes to rest on the floor (template_task has no plan).
    settle_s: float = 0.2
    # Send each joint target this much earlier than the plan has it; "model" leads
    # by the compiled actuator filter plus the joint's lag behind its servo
    # (damping / (gain + stiffness)), averaged over the leg joints and rounded to
    # the 2 ms control step.
    target_lead_s: float | str = 0.0
    # Switch each claw's adhesion this much earlier than the plan's stance;
    # "model" leads by the compiled adhesion filter's time constant (none: 0).
    adhesion_lead_s: float | str = 0.0
    adhesion: str = "stance"  # "stance": on in stance, off in swing; "off": never on
    incline: Incline | None = None
    friction: float | None = None  # claw and floor sliding friction both set to this
    push: Push | None = None
    step: Step | None = None
    # A diagnostic, not a situation: gravity off and the fly held 1 cm above the
    # floor, so the legs move against nothing and only the servos' tracking shows.
    suspended: bool = False

    def describe(self) -> dict:
        return asdict(self)

    def validate(self) -> None:
        """Refuse options that cannot describe one run."""
        if self.suspended and (
            self.incline is not None or self.push is not None or self.step is not None
        ):
            raise ValueError("a suspended run has no floor to incline, push along or step onto")
        if self.adhesion not in ("stance", "off"):
            raise ValueError(f"unknown adhesion option {self.adhesion}")
        for name in ("target_lead_s", "adhesion_lead_s"):
            value = getattr(self, name)
            if value != "model" and not (isinstance(value, (int, float)) and 0 <= value <= 0.1):
                raise ValueError(f"{name} must be 'model' or between 0 and 0.1 s")
        if self.friction is not None and not 0 < self.friction <= 2:
            raise ValueError("friction must be in (0, 2]")
        if self.settle_s < 0:
            raise ValueError("settle_s must not be negative")


@dataclass
class Recording:
    """The physical fly, sampled on the plan's clock (sample k at plan time t[k])."""

    t: np.ndarray
    thorax: np.ndarray  # (n, 3) cm, world
    xmat: np.ndarray  # (n, 3, 3) thorax orientation, world from body
    claws: np.ndarray  # (n, 6, 3) cm, world
    claws_local: np.ndarray  # (n, 6, 3) cm, thorax frame
    touch: np.ndarray  # (n, 6) bool: the claw's touch sensor reads a contact
    body_contact: np.ndarray  # (n,) bool: thorax, head, abdomen or wings touch the ground
    joint_error: np.ndarray  # (n,) rad: mean |joint angle - plan target| over the leg joints
    terminated_at_s: float | None
    task: dict = field(default_factory=dict)
    applied: dict = field(default_factory=dict)
    # Each body part other than the legs that touched the ground, and for how many samples.
    body_parts_touching: dict = field(default_factory=dict)


# MuJoCo's enums compare as integers only one way round (a NumPy integer `in` a
# tuple of enum members is False), so every type field is compared as an int.
FILTERED = {int(mujoco.mjtDyn.mjDYN_FILTER), int(mujoco.mjtDyn.mjDYN_FILTEREXACT)}
NO_DYNAMICS = int(mujoco.mjtDyn.mjDYN_NONE)
JOINT = int(mujoco.mjtTrn.mjTRN_JOINT)
CAPSULE, SPHERE, BOX = (
    int(mujoco.mjtGeom.mjGEOM_CAPSULE),
    int(mujoco.mjtGeom.mjGEOM_SPHERE),
    int(mujoco.mjtGeom.mjGEOM_BOX),
)


def _time_constant(m, a: int) -> float:
    """An actuator's activation filter time constant (s), or 0 without one."""
    return float(m.actuator_dynprm[a, 0]) if int(m.actuator_dyntype[a]) in FILTERED else 0.0


def _actuator_lags(m) -> dict:
    """The filters and the leg joints' lags as the compiled model holds them."""
    filters, joints, adhesion = [], [], []
    for a in range(m.nu):
        name = mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_ACTUATOR, a) or ""
        if "adhere_claw" in name:
            adhesion.append(_time_constant(m, a))
            continue
        if not any(s in name for s in ("coxa", "femur", "tibia", "tarsus")):
            continue
        filters.append(_time_constant(m, a))
        if int(m.actuator_trntype[a]) == JOINT:
            j = m.actuator_trnid[a, 0]
            kp = float(m.actuator_gainprm[a, 0])
            joints.append(float(m.dof_damping[m.jnt_dofadr[j]]) / (kp + float(m.jnt_stiffness[j])))
    return {
        "joint_filter_s": float(np.mean(filters)),
        "joint_lag_s": float(np.mean(joints)),
        "adhesion_filter_s": float(np.mean(adhesion)),
    }


def _requested_filters() -> dict:
    """What template_task asks the walker for, from its own signature."""
    import inspect

    from flybody.fly_envs import template_task

    params = inspect.signature(template_task).parameters
    return {
        "requested_joint_filter_s": params["joint_filter"].default,
        "requested_adhesion_filter_s": params["adhesion_filter"].default,
    }


def _lead_steps(value: float | str, model_value: float) -> tuple[int, float]:
    seconds = model_value if value == "model" else float(value)
    steps = round(seconds / CONTROL_DT_S)
    return steps, steps * CONTROL_DT_S


def _bottom(m, d, g: int) -> float | None:
    """The lowest point of a capsule, sphere or box geom (cm), or None."""
    size = m.geom_size[g]
    R = d.geom_xmat[g].reshape(3, 3)
    z = d.geom_xpos[g][2]
    kind = int(m.geom_type[g])
    if kind == CAPSULE:
        return float(z - size[0] - size[1] * abs(R[2, 2]))
    if kind == SPHERE:
        return float(z - size[0])
    if kind == BOX:
        return float(z - np.abs(R[2, :]) @ size)
    return None


def build_env(duration_s: float, options: Options, seed: int = 0):
    """FlyBody's template walking task, with `options.step` added to its floor."""
    from flybody.fly_envs import template_task

    env = template_task(
        random_state=np.random.RandomState(seed),
        time_limit=options.settle_s + duration_s + 0.1,
    )
    if options.step is not None:
        s = options.step
        arena = env.task._arena
        floor = arena.ground_geoms[0]
        arena.mjcf_model.worldbody.add(
            "geom",
            name="fly_physics_step",
            type="box",
            size=(s.length_cm / 2, s.width_cm / 2, s.height_cm / 2),
            pos=(s.at_x_cm + s.length_cm / 2, 0, s.height_cm / 2),
            friction=floor.friction,
            solref=floor.solref,
            solimp=floor.solimp,
            rgba=(0.5, 0.5, 0.5, 1),
        )
    return env


def replay(trace: Trace, options: Options | None = None, seed: int = 0) -> Recording:
    """Run the plan on FlyBody's physics; record the physical fly on the plan's clock."""
    options = options or Options()
    options.validate()
    env = build_env(trace.duration_s, options, seed)
    env.reset()
    ph = env.physics
    m, d = ph.model.ptr, ph.data.ptr
    names = env.action_spec().name.split("\t")
    index = {n: i for i, n in enumerate(names)}
    missing = [a for a in trace.actuators if a not in index]
    if missing:
        raise ValueError(f"FlyBody's walker has no actuators {missing}")
    target_at = np.array([index[a] for a in trace.actuators])
    adhere_at = np.array([index[f"adhere_claw_{leg}"] for leg in LEGS])
    n = trace.t.shape[0]

    lags = _actuator_lags(m)
    lead, lead_s = _lead_steps(options.target_lead_s, lags["joint_filter_s"] + lags["joint_lag_s"])
    alead, alead_s = _lead_steps(options.adhesion_lead_s, lags["adhesion_filter_s"])

    applied: dict = {"target_lead_s": lead_s, "adhesion_lead_s": alead_s}
    g = float(np.linalg.norm(m.opt.gravity))
    if options.suspended:
        m.opt.gravity[:] = 0
        applied["gravity"] = [0.0, 0.0, 0.0]
    if options.incline is not None:
        th = math.radians(options.incline.deg)
        to = math.radians(options.incline.toward_deg)
        m.opt.gravity[:] = (
            -g * math.sin(th) * math.cos(to),
            -g * math.sin(th) * math.sin(to),
            -g * math.cos(th),
        )
        applied["gravity"] = [float(x) for x in m.opt.gravity]
    floor_geoms = [ph.bind(gg).element_id for gg in env.task._arena.ground_geoms]
    claw_geoms = [
        mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_GEOM, f"walker/tarsal_claw_{leg}_collision")
        for leg in LEGS
    ]
    if options.friction is not None:
        for gid in floor_geoms + claw_geoms:
            m.geom_friction[gid, 0] = options.friction
        applied["friction"] = options.friction

    def action(k: int) -> np.ndarray:
        a = np.zeros(len(names))
        a[target_at] = trace.targets[min(n - 1, k + lead)]
        if options.adhesion == "stance":
            a[adhere_at] = trace.stance[min(n - 1, k + alead)].astype(float)
        return a

    # The legs at the plan's first pose, each actuator's filter already at its target.
    q = ph.named.data.qpos
    for j, name in enumerate(trace.actuators):
        if not name.startswith("tarsus2"):
            q["walker/" + name] = trace.targets[0, j]
    a0 = action(0)
    for i in range(m.nu):
        name = (mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_ACTUATOR, i) or "").split("/")[-1]
        if int(m.actuator_dyntype[i]) != NO_DYNAMICS and name in index:
            d.act[m.actuator_actadr[i]] = a0[index[name]]
    mujoco.mj_forward(m, d)
    walker = {
        b
        for b in range(m.nbody)
        if (mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, b) or "").startswith("walker/")
    }
    bottoms = [
        z
        for gid in range(m.ngeom)
        if m.geom_bodyid[gid] in walker and (m.geom_contype[gid] | m.geom_conaffinity[gid])
        for z in [_bottom(m, d, gid)]
        if z is not None
    ]
    # Lower (or raise) the fly until its lowest collision geom just meets the
    # floor, or for a suspended run until it is 1 cm clear of it.
    q["walker/"][2] += (1.0 if options.suspended else 0.0) - min(bottoms)
    mujoco.mj_forward(m, d)

    thorax = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, "walker/thorax")
    claws = np.array(
        [mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, f"walker/claw_{leg}") for leg in LEGS]
    )
    touch = np.array(
        [
            m.sensor_adr[
                mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_SENSOR, f"walker/touch_claw_{leg}")
            ]
            for leg in LEGS
        ]
    )
    body_name = {
        b: (mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, b) or "").split("/")[-1] for b in walker
    }
    leg_body = {b for b in walker if any(s in body_name[b] for s in LEG_SEGMENTS)}
    joint_columns = np.array(
        [k for k, a in enumerate(trace.actuators) if not a.startswith("tarsus2")]
    )
    joint_qpos = np.array(
        [
            m.jnt_qposadr[
                mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, "walker/" + trace.actuators[k])
            ]
            for k in joint_columns
        ]
    )
    weight = g * float(m.body_subtreemass[thorax])
    adhesion_dyntypes = sorted(
        {
            int(m.actuator_dyntype[a])
            for a in range(m.nu)
            if "adhere_claw" in (mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_ACTUATOR, a) or "")
        }
    )

    rec = Recording(
        t=trace.t.copy(),
        thorax=np.zeros((n, 3)),
        xmat=np.zeros((n, 3, 3)),
        claws=np.zeros((n, 6, 3)),
        claws_local=np.zeros((n, 6, 3)),
        touch=np.zeros((n, 6), dtype=bool),
        body_contact=np.zeros(n, dtype=bool),
        joint_error=np.zeros(n),
        terminated_at_s=None,
        task={
            "factory": "flybody.fly_envs.template_task",
            "physics_timestep_s": float(m.opt.timestep),
            "control_timestep_s": float(env.control_timestep()),
            "gravity_cm_s2": g,
            "mass_g": float(m.body_subtreemass[thorax]),
            "weight_dyn": weight,
            **_requested_filters(),
            **lags,
            "adhesion_dyntype": [mujoco.mjtDyn(t).name for t in adhesion_dyntypes],
        },
        applied=applied,
    )

    def record(k: int) -> None:
        p = d.xpos[thorax].copy()
        R = d.xmat[thorax].reshape(3, 3).copy()
        rec.thorax[k] = p
        rec.xmat[k] = R
        rec.claws[k] = d.xpos[claws]
        rec.claws_local[k] = (d.xpos[claws] - p) @ R
        rec.touch[k] = d.sensordata[touch] > 0
        touched = set()
        for c in d.contact[: d.ncon]:
            b1, b2 = m.geom_bodyid[c.geom1], m.geom_bodyid[c.geom2]
            for mine, other in ((b1, b2), (b2, b1)):
                if mine in walker and other not in walker and mine not in leg_body:
                    touched.add(body_name[mine])
        rec.body_contact[k] = bool(touched)
        for part in touched:
            rec.body_parts_touching[part] = rec.body_parts_touching.get(part, 0) + 1
        rec.joint_error[k] = float(
            np.abs(d.qpos[joint_qpos] - trace.targets[k, joint_columns]).mean()
        )

    for _ in range(round(options.settle_s / CONTROL_DT_S)):
        env.step(a0)
    record(0)
    push = options.push
    for k in range(n - 1):
        if push is not None:
            on = push.start_s <= trace.t[k] < push.start_s + push.duration_s
            to = math.radians(push.toward_deg)
            # The direction is taken in the fly's frame at the start of the plan.
            R0 = rec.xmat[0]
            yaw0 = math.atan2(R0[1, 0], R0[0, 0])
            f = push.body_weights * weight if on else 0.0
            d.xfrc_applied[thorax, :3] = (f * math.cos(yaw0 + to), f * math.sin(yaw0 + to), 0.0)
        step = env.step(action(k))
        record(k + 1)
        if step.last():
            # FlyBody ends an episode early when the accelerations blow up
            # (its qacc check); the discount is then 0. The time limit is past the plan.
            if step.discount == 0.0:
                rec.terminated_at_s = float(trace.t[k + 1])
            rec.t = rec.t[: k + 2]
            for name in (
                "thorax",
                "xmat",
                "claws",
                "claws_local",
                "touch",
                "body_contact",
                "joint_error",
            ):
                setattr(rec, name, getattr(rec, name)[: k + 2])
            break
    if push is not None:
        applied["push_force_dyn"] = push.body_weights * weight
    return rec
