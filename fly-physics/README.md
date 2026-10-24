# FlyBody physics on the digital fly's plan

A research backend, separate from the browser. The digital fly
(`src/bethesda/fly/`, see [docs/DIGITAL_FLY.md](../docs/DIGITAL_FLY.md)) moves a
reduced-order body and draws its legs by inverse kinematics on FlyBody's own leg
chains. This package executes that walking plan on FlyBody's MuJoCo model and
measures how far the physical body follows it, on a flat floor and in situations
the kinematic body cannot represent: slopes, a wall, a ceiling, a slippery floor,
a sideways push, a step, claws without adhesion. The browser keeps its
reduced-order body for drawing and for the lab's experiments; nothing here feeds
back into it.

Everything it writes describes two simulators, the digital fly's kinematic plan
and FlyBody's physics. It is never evidence about _Drosophila_.

The [development priorities](../docs/FLY_PRIORITIES.md) put reliable physical
locomotion first, then aerodynamic forces and landing, then richer sensing,
with independent biological comparison guiding every stage. Run
`python -m fly_physics.readiness` from this directory to assess the initial
five-plan flat-floor gate against the current fly. It reads existing results;
it does not run the physics. Its thresholds are engineering choices, and a
pass covers only that initial suite.

## What it uses, and what it does not

- **FlyBody's Apache-2.0 code and model**, fetched by git at the commit the
  browser's anatomy was imported from (read from
  `src/bethesda/fly/data/flybody.source.json`, never written here). Before
  anything imports FlyBody, the checkout must be exactly that commit with no
  local changes, and every file the importer read (the MJCF and its meshes) must
  hash to the importer's SHA-256 (the importer read CRLF line endings, so a text
  file also matches in its CRLF form; which form matched is recorded).
- **FlyBody's walking task**, `flybody.fly_envs.template_task()`, the empty
  walking task FlyBody provides for custom controllers. Its settings are read
  back from the compiled model and recorded. With dm_control 1.0.50 and MuJoCo
  3.17.0 the 10 ms filter template_task asks for on the joint actuators is
  there, but the claw adhesion actuators have no activation dynamics at all, so
  the 7 ms adhesion filter it asks for does not take effect.
- **Not FlyBody's controller.** FlyBody's trained policies and reference
  trajectories are its GPL-3.0 figshare release; this package never fetches or
  uses them. The controller is the browser fly's open-loop plan.

## How a plan runs

`scripts/fly-physics-trace.ts` runs a `DigitalFly` in an empty arena under a
scripted decision maker (`PlanAdapter`: one walking speed and turn rate, every
command through the fly's gate) and samples, on FlyBody's 2 ms walking control
clock, what the browser draws: the thorax path, each leg's stance or swing, the
joint and tendon targets the pose solver gives FlyBody's 48 leg actuators, and
the claw positions that pose puts in the thorax frame. The reduced-order body
steps every 5 ms; between steps the trace interpolates as FlyView draws. Each
`fly-physics-trace/v1` names the fly's version and source digest and its own
SHA-256, and one scenario on one JavaScript engine always writes the same bytes
(`--check` compares).

`python -m fly_physics run` then, for each run:

1. builds template_task, poses the legs at the plan's first sample with each
   actuator's filter already at its target, lowers the fly until its lowest
   collision geom meets the floor, and holds that pose with every claw adhering
   for 0.2 s so it comes to rest;
2. at each control step sends the plan's targets to the leg actuators (as
   FlyBody's policies send their actions), switches each claw's adhesion on in
   stance and off in swing, and holds head and abdomen at zero;
3. records the thorax, its attitude, each claw (in the world and in the thorax
   frame), the claw touch sensors and any other body part touching the ground;
4. compares the physical path with the plan in FlyBody's frame at the start
   (x ahead, y left, z up, cm) and writes a sealed `fly-physics-result/v1`.

Two executions of every plan: `direct`, the targets at the times the plan has
them, and `lag-compensated`, each joint target early by the compiled actuator
filter plus the joints' mean lag behind their servos (damping / (gain +
stiffness)), read from the model and rounded to the control step. Anything else
that departs from template_task (an incline by turned gravity, friction, a push,
a step in the floor, adhesion off, the suspended diagnostic) is a named field of
`Options`, and every result records all of them and what they came to.

## Commands

From the repository root:

```sh
uv venv --python 3.12 .fly-physics/venv          # NumPy 1.26.4, which FlyBody pins, needs Python <= 3.12
uv pip install --python .fly-physics/venv/bin/python -r fly-physics/requirements.txt
node scripts/run-ts.mjs scripts/fly-physics-trace.ts      # writes .fly-physics/traces/
cd fly-physics
export MUJOCO_GL=disable                         # nothing is rendered
../.fly-physics/venv/bin/python -m fly_physics setup     # git clone + checkout + verify (.fly-physics/flybody)
../.fly-physics/venv/bin/python -m fly_physics run       # every run -> docs/benchmarks/fly-physics/
../.fly-physics/venv/bin/python -m fly_physics run --only walk-2cms--direct
../.fly-physics/venv/bin/python -m fly_physics list
../.fly-physics/venv/bin/python -m pytest -q tests
```

The whole matrix takes a few minutes; each run is about ten seconds. The tests
take about fifteen; the two that need FlyBody and a trace skip without them.
`.fly-physics/` (the environment, the FlyBody checkout and the traces) is
ignored by git: all of it is derived.

## Files

| file                       | what it does                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `fly_physics/source.py`    | the pinned commit (from the importer's manifest), the git fetch, verification, the import |
| `fly_physics/trace.py`     | reads and checks a `fly-physics-trace/v1`; identifies it by its file's SHA-256            |
| `fly_physics/replay.py`    | template_task, the settling hold, the control loop, every option, the recording           |
| `fly_physics/scenarios.py` | the fixed run matrix: plans, executions and situations                                    |
| `fly_physics/metrics.py`   | physical against planned path: speeds, heading, deviation, height, attitude, slip, falls  |
| `fly_physics/report.py`    | the sealed result files and the README written from them                                  |
| `fly_physics/__main__.py`  | the command line                                                                          |
| `tests/`                   | fast unit tests, and two against FlyBody's model (kinematics, determinism)                |

## Limitations

- Open loop: the plan does not see what the physical body does, so an error
  compounds. FlyBody's trained policies close this loop; this backend measures
  the plan without one.
- The plan's swing lift (at most 0.25 mm) and crouch are the browser's drawing
  choices; the backend executes them as they are and does not re-plan.
- MuJoCo is deterministic for one build on one machine; another platform, build
  or version may differ in the last digits.
- Wings are retracted, as in FlyBody's walking tasks: no flight, takeoff or
  landing physics here.
