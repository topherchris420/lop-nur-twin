"""The fixed set of runs: which plan, executed how, in what situation.

Two executions of every plan. `direct` sends the plan's targets as FlyBody's
actions at the times the plan has them, the way FlyBody's own policies act.
`lag-compensated` sends each joint target early by the compiled actuator
filter plus the joint's lag behind its servo, and each claw's adhesion early
by the compiled adhesion filter (which, built here, has none), all read from
the model: the one correction an open-loop plan can make for dynamics it
knows about. Neither changes FlyBody's model.

The situations are the ones the browser's kinematic body cannot represent:
slopes (gravity turned, which on a flat floor is the same as tilting it), a
ceiling, a slippery floor, a sideways push, a step in the floor, and claws
without adhesion. Each is run on the 2 cm/s plan with the lag-compensated
execution, the one that follows the plan more closely on flat ground. Their
sizes were fixed before any of them ran.
"""

from __future__ import annotations

from dataclasses import replace

from .replay import Incline, Options, Push, Step

PLANS = ("walk-1cms", "walk-2cms", "walk-3cms", "turn-on-the-spot", "walk-and-turn")

EXECUTIONS: dict[str, Options] = {
    "direct": Options(),
    "lag-compensated": Options(target_lead_s="model", adhesion_lead_s="model"),
}

PERTURBATIONS: dict[str, dict] = {
    "incline-up-15": {"incline": Incline(15.0, 0.0)},
    "incline-up-30": {"incline": Incline(30.0, 0.0)},
    "incline-up-45": {"incline": Incline(45.0, 0.0)},
    "incline-up-90": {"incline": Incline(90.0, 0.0)},
    "incline-down-30": {"incline": Incline(30.0, 180.0)},
    "incline-across-30": {"incline": Incline(30.0, 90.0)},
    "ceiling": {"incline": Incline(180.0, 0.0)},
    "friction-0.2": {"friction": 0.2},
    "push-left-1bw": {
        "push": Push(body_weights=1.0, toward_deg=90.0, start_s=1.0, duration_s=0.02)
    },
    "step-0.1mm": {"step": Step(height_cm=0.01, at_x_cm=1.0)},
    "adhesion-off": {"adhesion": "off"},
    "adhesion-off-incline-up-45": {"adhesion": "off", "incline": Incline(45.0, 0.0)},
    "suspended": {"suspended": True},
}
PERTURBED_PLAN = "walk-2cms"
PERTURBED_EXECUTION = "lag-compensated"


def runs() -> list[dict]:
    """Every run: its id, plan, execution, perturbation and options."""
    out = []
    for execution, options in EXECUTIONS.items():
        for plan in PLANS:
            out.append(
                {
                    "id": f"{plan}--{execution}",
                    "plan": plan,
                    "execution": execution,
                    "perturbation": None,
                    "options": options,
                }
            )
    for name, change in PERTURBATIONS.items():
        executions = (
            EXECUTIONS
            if name == "suspended"
            else {PERTURBED_EXECUTION: EXECUTIONS[PERTURBED_EXECUTION]}
        )
        for execution, options in executions.items():
            out.append(
                {
                    "id": f"{PERTURBED_PLAN}--{execution}--{name}",
                    "plan": PERTURBED_PLAN,
                    "execution": execution,
                    "perturbation": name,
                    "options": replace(options, **change),
                }
            )
    return out
