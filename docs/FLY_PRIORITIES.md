# Digital fly development priorities

The next development milestone is **commanded movement that survives physical
simulation**. Flight forces and richer sensing depend on that foundation.
Independent recordings guide the work from the start and remain the final
test of any claim about living flies.

This is a development order with engineering acceptance criteria. The new
readiness command assesses existing results; it does not implement a new gait,
aerodynamics, wind, vision or odour model.

## 1. Make locomotion reliable in physics

Work in the separate [physics backend](../fly-physics/README.md) first. Its
archived [benchmark](benchmarks/fly-physics/README.md) exposes the failure:
the lag-compensated 2 cm/s plan achieves 0.8195 cm/s, 0.3791 of the intended
forward progress, and −20.4594° heading drift over its two-second run. Turning
on the spot achieves about 2°/s against a commanded 115°/s. Remaining upright
alone is insufficient.

Those measurements describe **digital-fly/4**, not the current fly. Rebuild
the traces and run the matrix from one clean commit before attributing any
physical performance to the current version. Preserve the older results.

Implementation order:

1. Diagnose swing-foot dragging and stance adhesion against the recorded claw
   contacts, servo lag and actual joint positions. Check that a foot has
   released before trying to swing it.
2. Improve swing clearance and stance placement against the physical model's
   joint limits and contact geometry. Keep pure turning and walking while
   turning in the acceptance matrix so forward speed cannot conceal yaw errors.
3. If open-loop targets remain insufficient, add an explicitly named,
   separately benchmarked feedback controller inside the physics backend.
   Record its observations, gains, action limits and configuration. Keep the
   existing open-loop executions as controls. Any browser integration is a
   separate decision; every browser command still passes `validateCommand`.
4. After flat-floor tracking works, extend the command suite to right turns,
   speed changes, starts and stops, longer runs and multiple initial poses.
   Then test slopes, low friction, steps, pushes, walls and ceilings. Report
   each condition separately, including failures.

### Initial flat-floor gate

From the repository root, after installing the JavaScript dependencies:

```sh
cd fly-physics
python -m fly_physics.readiness
```

This reads the sealed benchmark files, checks the current fly source with the
existing source checker, and prints deterministic JSON. It does not start or
install MuJoCo. `--out DIR` selects another results directory;
`--execution direct` assesses the other existing execution independently.
Exit 0 means the initial gate passes, 1 means blocked, and 2 means invalid
input or a failed prerequisite. Missing results and stale versions block.

The five required plans are straight walking at 1, 2 and 3 cm/s, turning on
the spot, and walking while turning. They must share a clean code commit,
FlyBody, environment and task. Each must complete its full plan of at least
two seconds without falling or early termination.

| Measure                                        | Initial requirement | Applies to     |
| ---------------------------------------------- | ------------------- | -------------- |
| Physical / planned speed                       | 0.8–1.2             | Walking plans  |
| Signed forward progress / planned displacement | 0.8–1.2             | Walking plans  |
| Signed physical / planned turn rate            | 0.8–1.2             | Turning plans  |
| Absolute total heading drift                   | ≤10°                | All five plans |
| Maximum distance off the planned path          | ≤1 mm               | All five plans |
| Maximum stance-foot slip                       | ≤0.1 mm             | All five plans |
| Swing samples with a claw touching             | ≤10%                | All five plans |
| Total non-leg body contact                     | ≤10 ms              | All five plans |

These are **engineering choices**, versioned in
`fly_physics/readiness.py`, not measured biological tolerances. Do not lower
them merely to pass the current controller. A pass covers this short flat-floor
suite only; it does not establish robust locomotion across conditions or
biological realism. The result seals detect changes to recorded bytes; they
do not independently authenticate a scientific measurement.

## 2. Add aerodynamic forces, wind and physical landing

Start with a bounded force-based research model that records its units,
mass, force coefficients and integration clock. Test still-air equilibrium,
drag against air-relative velocity, crosswind drift, gust recovery and
timestep convergence before connecting it to decisions. A drawn wingbeat or
a velocity tracker is not aerodynamic validation.

Use the same wind field for forces and later odour transport. Model landing
as approach, deceleration, leg extension, contact and settling, with explicit
rejection or recovery for excessive impact speed, oblique contact and missing
support. Compare touchdown speed, attitude, contact timing, rebound and
post-contact slip on horizontal and inclined surfaces. Expand to wall and
ceiling landings only when contact and adhesion support them. Do not hide
failed landings by snapping the thorax to a surface.

Advance when the physical checks are reproducible and the landing results
are reported by surface, approach speed and wind condition. Leave the city's
current reduced-order model labelled as such until integration is measured.

## 3. Improve visual processing and odour plumes

Build the sensory inputs before tuning the behavior they trigger:

- Vision: contrast, spatial sampling, temporal filtering and directional
  motion signals from the fly's viewpoint, including blind sectors,
  occlusion, darkness and sensory latency. Compare responses to controlled
  image sequences; never give the controller a hidden object's location.
- Odour: wind-advected intermittent concentration, separate left/right
  antennal samples, detection noise and adaptation. Test downwind versus
  upwind, plume edges, source removal and reacquisition. Distinguish a
  reduced-order plume approximation from validated fluid transport.
- Controller: let navigation and landing read these sensory measurements,
  then evaluate the complete loop. Report sensing errors separately from
  movement errors so one cannot conceal the other.

Advance when sensory unit checks and behavior comparisons both hold across
new conditions, with the simulator's approximations stated.

## 4. Expand independent comparison with living flies

Begin dataset selection and protocol design **alongside priority 1**. This is
fourth in feature delivery, not work to postpone until development ends.
The existing [calibration](benchmarks/fly-calibration/README.md) already
distinguishes design, fitted and held-out observations; retain that distinction.

Select independently recorded, appropriately licensed datasets covering
walking and turning, takeoff, flight and landing, looming responses,
odour-guided search and grooming. Record species, sex, age where available,
scale, frame rate, tracking uncertainty and experimental conditions. Unknown
metadata stay unknown. Summaries alone do not establish trajectory agreement.

Separate development and evaluation recordings by fly and session, not
adjacent video frames. Fit only on the development split; once a held-out
result informs tuning, label it development evidence and obtain a new holdout.
Apply the same tracking and summary pipeline to real and simulated sequences.
Compare speed and turn distributions, step timing, response latency, landing
outcomes and search trajectories, with sample counts and uncertainty by
condition. Include a simple baseline and ablations of the added mechanisms.

Predeclare metrics and acceptance rules before evaluating the holdout. Report
unmatched conditions and negative findings. A successful physics gate remains
a simulator result; only independent comparisons can support a bounded claim
about biological behavior.
