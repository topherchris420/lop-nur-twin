"""Results on disk: one `fly-physics-result/v1` per run, and a README written from them.

A result names everything that produced it: the plan (its file's SHA-256 and
the fly code that wrote it), FlyBody (the verified commit), the environment's
versions, the task's settings, every option and what it came to. Its own
`sha256` is over the rest of it as canonical JSON (sorted keys, no spaces,
UTF-8, Python's json). The README is generated from the result files alone.
"""

from __future__ import annotations

import hashlib
import json
import platform
import subprocess
import sys
from importlib import metadata
from pathlib import Path

from . import RESULT_SCHEMA

EVIDENCE = (
    "simulated: FlyBody's MuJoCo physics driven open loop by the digital fly's kinematic plan; "
    "it describes these two simulators, never Drosophila"
)


def environment() -> dict:
    def version(dist: str) -> str | None:
        try:
            return metadata.version(dist)
        except metadata.PackageNotFoundError:
            return None

    return {
        "python": platform.python_version(),
        "implementation": sys.implementation.name,
        "platform": f"{sys.platform} {platform.machine()}",
        "mujoco": version("mujoco"),
        "dm_control": version("dm-control"),
        "numpy": version("numpy"),
        "scipy": version("scipy"),
    }


def code_state(root: Path, results: Path) -> dict:
    """This repository's commit, and whether anything but the results differs from it.

    Unknown (no git, no commit) is null, never guessed."""

    def git(*args: str) -> str | None:
        try:
            return subprocess.run(
                ["git", "-C", str(root), *args],
                check=True,
                capture_output=True,
                text=True,
                timeout=60,
            ).stdout
        except (OSError, subprocess.SubprocessError):
            return None

    commit = git("rev-parse", "HEAD")
    status = git("status", "--porcelain", "--untracked-files=all")
    try:
        skip = results.resolve().relative_to(root.resolve()).as_posix() + "/"
    except ValueError:
        skip = None
    changed = (
        None
        if status is None
        else [line for line in status.splitlines() if not (skip and line[3:].startswith(skip))]
    )
    return {
        "commit": commit.strip() if commit else None,
        "dirty": None if changed is None else bool(changed),
    }


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sealed(body: dict) -> dict:
    return {**body, "sha256": hashlib.sha256(canonical(body).encode("utf-8")).hexdigest()}


def result(run: dict, trace, rec, metrics: dict, series: dict, flybody: dict, code: dict) -> dict:
    return sealed(
        {
            "schema": RESULT_SCHEMA,
            "id": run["id"],
            "code": code,
            "plan": trace.describe(),
            "execution": run["execution"],
            "perturbation": run["perturbation"],
            "options": run["options"].describe(),
            "applied": rec.applied,
            "task": rec.task,
            "flybody": flybody,
            "environment": environment(),
            "evidence": EVIDENCE,
            "metrics": metrics,
            "series": series,
        }
    )


def write(out: Path, data: dict) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{data['id']}.json"
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def load_results(out: Path) -> list[dict]:
    results = []
    for path in sorted(out.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("schema") != RESULT_SCHEMA:
            continue
        body = {k: v for k, v in data.items() if k != "sha256"}
        if sealed(body)["sha256"] != data.get("sha256"):
            raise ValueError(f"{path} does not match its own sha256")
        results.append(data)
    return results


def _code_text(code: dict) -> str:
    if not code.get("commit"):
        return "an unknown commit"
    state = {False: "no other changes", True: "uncommitted changes", None: "an unknown state"}[
        code["dirty"]
    ]
    return f"commit `{code['commit'][:12]}`, with {state} besides these results"


def _adhesion_text(task: dict) -> str:
    if task["adhesion_filter_s"] > 0:
        return f"a {task['adhesion_filter_s'] * 1000:g} ms adhesion filter"
    kinds = ", ".join(task["adhesion_dyntype"])
    return f"claw adhesion with no activation filter at all (dynamics {kinds}): the adhesion switches at once"


def _f(x, digits: int = 2, unit: str = "") -> str:
    if x is None:
        return "—"
    if isinstance(x, bool):
        return "yes" if x else "no"
    return f"{x:.{digits}f}{unit}"


def _situation(name: str, o: dict) -> str:
    """What a perturbation is, from the options its result recorded."""
    parts = []
    if o["incline"]:
        deg, to = o["incline"]["deg"], o["incline"]["toward_deg"]
        where = {0.0: "ahead", 180.0: "behind", 90.0: "to the left", -90.0: "to the right"}.get(
            to, f"toward {to:g}°"
        )
        kind = {90.0: " (a wall)", 180.0: " (a ceiling)"}.get(deg, "")
        parts.append(
            f"gravity turned {deg:g}°{kind}, the floor rising {where}"
            if deg != 180.0
            else f"gravity turned {deg:g}°{kind}"
        )
    if o["friction"] is not None:
        parts.append(f"claw and floor sliding friction {o['friction']:g}")
    if o["push"]:
        p = o["push"]
        parts.append(
            f"a push of {p['body_weights']:g} body weight toward {p['toward_deg']:g}° "
            f"(90° is left) for {p['duration_s'] * 1000:g} ms from {p['start_s']:g} s"
        )
    if o["step"]:
        s = o["step"]
        parts.append(f"a slab {s['height_cm'] * 10:g} mm high from {s['at_x_cm']:g} cm ahead")
    if o["adhesion"] == "off":
        parts.append("claw adhesion never on")
    return f"- **{name}**: " + "; ".join(parts) + "."


def _fell(m: dict) -> str:
    if m["fell"] is None:
        return "—"
    return f"at {m['fell_at_s']:.2f} s" if m["fell"] else "no"


def _row(r: dict) -> str:
    m = r["metrics"]
    return (
        f"| {r['plan']['id']} | {r['execution']} | {r['perturbation'] or '—'} "
        f"| {_f(m['planned_speed_cms'])} | {_f(m['physical_speed_cms'])} | {_f(m['speed_ratio'])} "
        f"| {_f(m['progress_ratio'])} "
        f"| {_f(m['planned_turn_rate_dps'], 0)} | {_f(m['physical_turn_rate_dps'], 0)} "
        f"| {_f(m['heading_drift_deg'], 0)} | {_f(m['path_deviation_final_cm'])} "
        f"| {_f(m['height_mean_cm'] * 10 if m['height_mean_cm'] is not None else None, 2)} "
        f"({_f(m['height_min_cm'] * 10 if m['height_min_cm'] is not None else None, 2)}–"
        f"{_f(m['height_max_cm'] * 10 if m['height_max_cm'] is not None else None, 2)}) "
        f"| {_f(m['tilt_max_deg'], 0)} | {_f(m['stance_slip_mean_mm'], 3)} ({_f(m['stance_slip_max_mm'], 3)}) "
        f"| {_f(m['swing_claws_touching'])} | {_f(m['claw_error_mean_mm'], 3)} "
        f"| {_f(m['body_contact_s'], 3)} | {_fell(m)} |"
    )


HEADER = (
    "| plan | execution | situation | planned speed (cm/s) | physical speed (cm/s) | speed ratio "
    "| progress | planned turn (°/s) | physical turn (°/s) | heading drift (°) | off the path at the end (cm) "
    "| thorax height, mean (min–max) (mm) | max tilt (°) | stance slip, mean (max) (mm) "
    "| swing claws touching | claw error (mm) | body on the floor (s) | fell |\n"
    "| :-- | :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: | :-- | --: | :-- | --: | --: | --: | :-- |"
)


def readme(results: list[dict]) -> str:
    if not results:
        return "# FlyBody physics on the digital fly's plan\n\nNo results yet.\n"
    first = results[0]
    if len({canonical(r["code"]) for r in results}) != 1:
        raise ValueError("the results come from different code; rerun them all from one commit")
    fb, env, task = first["flybody"], first["environment"], first["task"]
    planned_h = first["metrics"]["planned_height_cm"]
    base = [r for r in results if r["perturbation"] is None]
    perturbed = [r for r in results if r["perturbation"] not in (None, "suspended")]
    suspended = [r for r in results if r["perturbation"] == "suspended"]
    plans = {}
    for r in results:
        plans[r["plan"]["id"]] = r["plan"]
    plan_rows = "\n".join(
        f"| {p['id']} | {p['description']} | `{p['file_sha256'][:12]}` | {p['fly_version']} "
        f"| `{p['fly_source_sha256'][:12]}` | {p['engine']['runtime']} {p['engine']['version']} |"
        for p in plans.values()
    )
    lead = {r["execution"]: r["applied"] for r in results if r["perturbation"] is None}
    comp = lead.get("lag-compensated", {})
    suspended_rows = "\n".join(
        f"| {r['execution']} | {_f(r['metrics']['claw_error_mean_mm'], 3)} | {_f(r['metrics']['joint_error_mean_rad'], 3)} |"
        for r in suspended
    )
    return f"""# FlyBody physics on the digital fly's plan

Written by `python -m fly_physics run` (fly-physics/) from the result files in
this folder; never edit it by hand. Each run drives FlyBody's own MuJoCo model
open loop with the browser fly's walking plan and measures how far the physical
body follows it. **These are measurements of two simulators, the digital fly's
kinematic plan and FlyBody's physics, never evidence about Drosophila.** The
controller is the plan, not FlyBody's trained policy: FlyBody's policies are in
its GPL-3.0 figshare release, which this repository does not fetch or use.

## What ran

- This repository at {_code_text(first["code"])}.
- FlyBody `{fb["repository"]}` at `{fb["commit"]}` ({fb["license"]}), verified
  before import: the checkout at that commit with no local changes, and all
  {fb["inputs_checked"]} files the browser's anatomy was imported from
  (`src/bethesda/fly/data/flybody.source.json`) identical to the importer's
  ({fb["inputs_byte_identical"]} byte for byte, {fb["inputs_identical_as_crlf"]}
  identical once converted to the CRLF line endings the importer read).
- FlyBody's walking task, `{task["factory"]}()`: a {task["physics_timestep_s"] * 1000:g} ms physics step, a
  {task["control_timestep_s"] * 1000:g} ms control step, position actuators, wings retracted. Mass
  {task["mass_g"] * 1000:.3f} mg, gravity {task["gravity_cm_s2"]:g} cm/s². template_task asks for a
  {task["requested_joint_filter_s"] * 1000:g} ms filter on the joint actuators and a
  {task["requested_adhesion_filter_s"] * 1000:g} ms filter on the claw adhesion; the compiled model holds a
  {task["joint_filter_s"] * 1000:g} ms joint filter and {_adhesion_text(task)}.
- Python {env["python"]}, MuJoCo {env["mujoco"]}, dm_control {env["dm_control"]},
  NumPy {env["numpy"]}, SciPy {env["scipy"]}, on {env["platform"]}.
- The plans, written by `node scripts/run-ts.mjs scripts/fly-physics-trace.ts`
  (the reduced-order body steps every 5 ms; the plan is interpolated onto the
  2 ms control clock as FlyView draws it). The plan stands the thorax
  {planned_h * 10:.3f} mm above the floor, the browser fly's crouch.

| plan | what it commands | trace SHA-256 | fly | fly source | written on |
| :-- | :-- | :-- | :-- | :-- | :-- |
{plan_rows}

## How a plan is executed

Each control step sends the plan's joint and tendon targets to FlyBody's leg
actuators, as FlyBody's own policies send their actions, switches each claw's
adhesion on in stance and off in swing, and holds head and abdomen at zero.
Before the plan starts the fly holds its first pose with every claw adhering
for {first["options"]["settle_s"]:g} s, so it rests on the floor.

- **direct**: the targets at the times the plan has them.
- **lag-compensated**: every joint target {_f(comp.get("target_lead_s", 0) * 1000, 0)} ms early (the compiled
  {task["joint_filter_s"] * 1000:g} ms actuator filter plus the joints' mean lag behind their servos,
  damping / (gain + stiffness), {task["joint_lag_s"] * 1000:.1f} ms, rounded to the control step) and each
  claw's adhesion {_f(comp.get("adhesion_lead_s", 0) * 1000, 0)} ms early (the compiled adhesion filter's time
  constant). Read from the compiled model; FlyBody's model itself is not changed.

## Flat floor

Speeds and turn rates are means from {0.5:g} s (after the plan's walking speed
has ramped up from rest) to the end, on the thorax sampled every 20 ms; the
speed is the path's length over time, whichever way it goes. Progress is the
physical displacement along the planned one, as a share of it: 1 is the plan's
distance in its direction, a negative value is backwards. Heading drift is the
physical heading change minus the planned one. "Off the path" is the distance
from the final physical position to the nearest point of the planned path. Slip
is how far a stance claw moved over the floor between touchdown and lift-off.
"Swing claws touching" is the share of swing samples in which a claw still
touched the floor, so it dragged. "Claw error" is the mean distance in the
thorax frame between where the physical claws were and where the plan put them.
A fall is a tilt over 60° or no claw touching for over 100 ms; after a fall,
every other figure covers the time before it, since a tumbling body follows no
plan. "Body on the floor" is how long any part other than the legs touched the
ground, with the parts named in each result.

{HEADER}
{chr(10).join(_row(r) for r in base)}

## Situations the kinematic body cannot represent

The browser's reduced-order body walks a plan the same way whatever the slope,
the friction or a push; FlyBody's physics does not. Turning gravity on a flat
floor is the same as tilting the floor. Their sizes were fixed before any of
them ran:

{chr(10).join(_situation(r["perturbation"], r["options"]) for r in perturbed)}

{HEADER}
{chr(10).join(_row(r) for r in perturbed)}

## The servos alone

A diagnostic, not a situation: gravity off and the fly held 1 cm above the
floor, so the legs move against nothing and only the actuators' tracking of
the plan shows.

| execution | claw error (mm) | joint error (rad) |
| :-- | --: | --: |
{suspended_rows}

## Reproduce

```sh
uv venv --python 3.12 .fly-physics/venv
uv pip install --python .fly-physics/venv/bin/python -r fly-physics/requirements.txt
node scripts/run-ts.mjs scripts/fly-physics-trace.ts
cd fly-physics
MUJOCO_GL=disable ../.fly-physics/venv/bin/python -m fly_physics setup
MUJOCO_GL=disable ../.fly-physics/venv/bin/python -m fly_physics run
```

MuJoCo is deterministic for one build on one machine; another platform, build
or version may differ in the last digits. Each result records its own SHA-256
and everything above.
"""
