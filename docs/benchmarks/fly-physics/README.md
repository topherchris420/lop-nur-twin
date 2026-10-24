# FlyBody physics on the digital fly's plan

Written by `python -m fly_physics run` (fly-physics/) from the result files in
this folder; never edit it by hand. Each run drives FlyBody's own MuJoCo model
open loop with the browser fly's walking plan and measures how far the physical
body follows it. **These are measurements of two simulators, the digital fly's
kinematic plan and FlyBody's physics, never evidence about Drosophila.** The
controller is the plan, not FlyBody's trained policy: FlyBody's policies are in
its GPL-3.0 figshare release, which this repository does not fetch or use.

## What ran

- This repository at commit `2296c7b675f0`, with no other changes besides these results.
- FlyBody `TuragaLab/flybody` at `d015e9bfe441bd90ae431bac24c55cb74bdbce26` (Apache-2.0), verified
  before import: the checkout at that commit with no local changes, and all
  87 files the browser's anatomy was imported from
  (`src/bethesda/fly/data/flybody.source.json`) identical to the importer's
  (0 byte for byte, 87
  identical once converted to the CRLF line endings the importer read).
- FlyBody's walking task, `flybody.fly_envs.template_task()`: a 0.2 ms physics step, a
  2 ms control step, position actuators, wings retracted. Mass
  0.985 mg, gravity 981 cm/s². template_task asks for a
  10 ms filter on the joint actuators and a
  7 ms filter on the claw adhesion; the compiled model holds a
  10 ms joint filter and claw adhesion with no activation filter at all (dynamics mjDYN_NONE): the adhesion switches at once.
- Python 3.12.3, MuJoCo 3.17.0, dm_control 1.0.50,
  NumPy 1.26.4, SciPy 1.17.1, on linux x86_64.
- The plans, written by `node scripts/run-ts.mjs scripts/fly-physics-trace.ts`
  (the reduced-order body steps every 5 ms; the plan is interpolated onto the
  2 ms control clock as FlyView draws it). The plan stands the thorax
  1.055 mm above the floor, the browser fly's crouch.

| plan | what it commands | trace SHA-256 | fly | fly source | written on |
| :-- | :-- | :-- | :-- | :-- | :-- |
| turn-on-the-spot | turning on the spot at 2 rad/s to the left | `ae382d45ceca` | digital-fly/4 | `69a28d589771` | node 22.22.0 |
| walk-1cms | straight walking at 1 cm/s | `0e48f67ecc20` | digital-fly/4 | `69a28d589771` | node 22.22.0 |
| walk-2cms | straight walking at 2 cm/s | `2d511f7344cf` | digital-fly/4 | `69a28d589771` | node 22.22.0 |
| walk-3cms | straight walking at 3 cm/s | `365e89dc3576` | digital-fly/4 | `69a28d589771` | node 22.22.0 |
| walk-and-turn | walking at 2 cm/s while turning at 1 rad/s to the left | `e4051cf24673` | digital-fly/4 | `69a28d589771` | node 22.22.0 |

## How a plan is executed

Each control step sends the plan's joint and tendon targets to FlyBody's leg
actuators, as FlyBody's own policies send their actions, switches each claw's
adhesion on in stance and off in swing, and holds head and abdomen at zero.
Before the plan starts the fly holds its first pose with every claw adhering
for 0.2 s, so it rests on the floor.

- **direct**: the targets at the times the plan has them.
- **lag-compensated**: every joint target 24 ms early (the compiled
  10 ms actuator filter plus the joints' mean lag behind their servos,
  damping / (gain + stiffness), 13.7 ms, rounded to the control step) and each
  claw's adhesion 0 ms early (the compiled adhesion filter's time
  constant). Read from the compiled model; FlyBody's model itself is not changed.

## Flat floor

Speeds and turn rates are means from 0.5 s (after the plan's walking speed
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

| plan | execution | situation | planned speed (cm/s) | physical speed (cm/s) | speed ratio | progress | planned turn (°/s) | physical turn (°/s) | heading drift (°) | off the path at the end (cm) | thorax height, mean (min–max) (mm) | max tilt (°) | stance slip, mean (max) (mm) | swing claws touching | claw error (mm) | body on the floor (s) | fell |
| :-- | :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: | :-- | --: | :-- | --: | --: | --: | :-- |
| turn-on-the-spot | direct | — | 0.00 | 0.04 | — | — | 115 | 6 | -215 | 0.06 | 1.02 (1.01–1.04) | 4 | 0.020 (0.066) | 0.57 | 0.099 | 0.000 | no |
| turn-on-the-spot | lag-compensated | — | 0.00 | 0.02 | — | — | 115 | 2 | -223 | 0.01 | 0.98 (0.97–1.04) | 4 | 0.001 (0.004) | 0.97 | 0.099 | 0.000 | no |
| walk-1cms | direct | — | 1.00 | 0.36 | 0.36 | 0.18 | 0 | 7 | 11 | 0.05 | 1.02 (0.93–1.11) | 8 | 0.110 (0.275) | 0.46 | 0.212 | 0.062 | no |
| walk-1cms | lag-compensated | — | 1.00 | 0.47 | 0.47 | 0.41 | 0 | -15 | -24 | 0.10 | 0.99 (0.93–1.03) | 7 | 0.021 (0.084) | 0.55 | 0.172 | 0.044 | no |
| walk-2cms | direct | — | 2.00 | 0.63 | 0.31 | 0.10 | 0 | -63 | -95 | 0.06 | 1.03 (0.91–1.17) | 11 | 0.160 (0.453) | 0.35 | 0.333 | 0.026 | no |
| walk-2cms | lag-compensated | — | 2.00 | 0.82 | 0.41 | 0.38 | 0 | -12 | -20 | 0.37 | 0.98 (0.94–1.02) | 6 | 0.054 (0.124) | 0.50 | 0.234 | 0.010 | no |
| walk-3cms | direct | — | 3.00 | 0.90 | 0.30 | 0.05 | 0 | -90 | -148 | 0.14 | 1.01 (0.90–1.13) | 7 | 0.252 (0.636) | 0.38 | 0.416 | 0.046 | no |
| walk-3cms | lag-compensated | — | 3.00 | 1.09 | 0.36 | 0.38 | 0 | 1 | -0 | 0.16 | 0.98 (0.93–1.03) | 6 | 0.059 (0.133) | 0.50 | 0.277 | 0.026 | no |
| walk-and-turn | direct | — | 2.00 | 0.59 | 0.30 | 0.05 | 57 | -57 | -198 | 0.07 | 1.02 (0.91–1.15) | 11 | 0.154 (0.405) | 0.39 | 0.327 | 0.030 | no |
| walk-and-turn | lag-compensated | — | 2.00 | 0.80 | 0.40 | 0.28 | 57 | 12 | -90 | 0.42 | 0.98 (0.93–1.02) | 6 | 0.047 (0.096) | 0.51 | 0.230 | 0.010 | no |

## Situations the kinematic body cannot represent

The browser's reduced-order body walks a plan the same way whatever the slope,
the friction or a push; FlyBody's physics does not. Turning gravity on a flat
floor is the same as tilting the floor. Their sizes were fixed before any of
them ran:

- **adhesion-off-incline-up-45**: gravity turned 45°, the floor rising ahead; claw adhesion never on.
- **adhesion-off**: claw adhesion never on.
- **ceiling**: gravity turned 180° (a ceiling).
- **friction-0.2**: claw and floor sliding friction 0.2.
- **incline-across-30**: gravity turned 30°, the floor rising to the left.
- **incline-down-30**: gravity turned 30°, the floor rising behind.
- **incline-up-15**: gravity turned 15°, the floor rising ahead.
- **incline-up-30**: gravity turned 30°, the floor rising ahead.
- **incline-up-45**: gravity turned 45°, the floor rising ahead.
- **incline-up-90**: gravity turned 90° (a wall), the floor rising ahead.
- **push-left-1bw**: a push of 1 body weight toward 90° (90° is left) for 20 ms from 1 s.
- **step-0.1mm**: a slab 0.1 mm high from 1 cm ahead.

| plan | execution | situation | planned speed (cm/s) | physical speed (cm/s) | speed ratio | progress | planned turn (°/s) | physical turn (°/s) | heading drift (°) | off the path at the end (cm) | thorax height, mean (min–max) (mm) | max tilt (°) | stance slip, mean (max) (mm) | swing claws touching | claw error (mm) | body on the floor (s) | fell |
| :-- | :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: | :-- | --: | :-- | --: | --: | --: | :-- |
| walk-2cms | lag-compensated | adhesion-off-incline-up-45 | 2.00 | 21.51 | 10.76 | -10.55 | 0 | -20 | -14 | 40.17 | 1.03 (0.93–1.13) | 8 | 8.995 (10.386) | 0.07 | 0.200 | 0.000 | no |
| walk-2cms | lag-compensated | adhesion-off | 2.00 | 0.63 | 0.31 | 0.15 | 0 | 9 | 11 | 0.04 | 1.00 (0.90–1.05) | 7 | 0.236 (0.857) | 0.51 | 0.211 | 0.036 | no |
| walk-2cms | lag-compensated | ceiling | — | — | — | — | — | — | -1 | 0.01 | 1.14 (1.09–1.17) | 6 | — (—) | 0.24 | 0.097 | 0.000 | at 0.06 s |
| walk-2cms | lag-compensated | friction-0.2 | 2.00 | 1.07 | 0.53 | 0.52 | 0 | -13 | -19 | 0.27 | 0.97 (0.88–1.01) | 7 | 0.056 (0.126) | 0.59 | 0.208 | 0.368 | no |
| walk-2cms | lag-compensated | incline-across-30 | 2.00 | 0.86 | 0.43 | 0.43 | 0 | 4 | 5 | 0.29 | 1.00 (0.95–1.04) | 6 | 0.057 (0.133) | 0.47 | 0.216 | 0.000 | no |
| walk-2cms | lag-compensated | incline-down-30 | 2.00 | 0.84 | 0.42 | 0.40 | 0 | -9 | -21 | 0.35 | 0.99 (0.94–1.04) | 5 | 0.066 (0.141) | 0.49 | 0.244 | 0.000 | no |
| walk-2cms | lag-compensated | incline-up-15 | 2.00 | 0.82 | 0.41 | 0.38 | 0 | -9 | -16 | 0.32 | 0.99 (0.94–1.03) | 7 | 0.047 (0.129) | 0.50 | 0.226 | 0.018 | no |
| walk-2cms | lag-compensated | incline-up-30 | 2.00 | 0.84 | 0.42 | 0.40 | 0 | -6 | -11 | 0.28 | 1.00 (0.94–1.04) | 7 | 0.042 (0.122) | 0.49 | 0.215 | 0.000 | no |
| walk-2cms | lag-compensated | incline-up-45 | 2.00 | 0.86 | 0.43 | 0.41 | 0 | -4 | -8 | 0.24 | 1.01 (0.94–1.06) | 7 | 0.037 (0.112) | 0.44 | 0.205 | 0.000 | no |
| walk-2cms | lag-compensated | incline-up-90 | — | — | — | — | — | — | 47 | 0.22 | 1.26 (1.02–2.06) | 48 | — (—) | 0.41 | 0.108 | 0.002 | at 0.10 s |
| walk-2cms | lag-compensated | push-left-1bw | 2.00 | 0.82 | 0.41 | 0.38 | 0 | -11 | -19 | 0.35 | 0.98 (0.94–1.02) | 6 | 0.054 (0.139) | 0.51 | 0.234 | 0.010 | no |
| walk-2cms | lag-compensated | step-0.1mm | 2.00 | 0.60 | 0.30 | 0.25 | 0 | 2 | -0 | 0.16 | 0.98 (0.94–1.02) | 6 | 0.081 (0.383) | 0.56 | 0.261 | 0.012 | no |

## The servos alone

A diagnostic, not a situation: gravity off and the fly held 1 cm above the
floor, so the legs move against nothing and only the actuators' tracking of
the plan shows.

| execution | claw error (mm) | joint error (rad) |
| :-- | --: | --: |
| direct | 0.309 | 0.087 |
| lag-compensated | 0.183 | 0.052 |

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
