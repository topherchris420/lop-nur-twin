# Project ECHO — experimental computational self-modeling

The fly maintains and updates a computational estimate of its sensorimotor
capabilities. That estimate can change its walking commands. This is a research
implementation of functional self-modeling, not evidence of subjective
consciousness, personal identity, or biological motor control.

## Run and inspect

Start the site normally, open `/?echo=1`, enter Bethesda through its existing
coordinate resolver, and open **Fly → Self-Model**. The existing reduced-order
controller remains the default without `echo=1`. Opening the panel never steps,
resets or teaches the fly. An experimental headless instance is available as
`new HeadlessBethesdaLife(config, { echo: "full" })`.

The self-model runs on the fly's fixed simulation clock, without a renderer,
network calls, model inference or another agent framework. Escape interrupts,
feeding, takeoff, flight and landing retain native arbitration. Compensation
currently changes **walking speed and walking turn rate** only. Motion estimates
continue in other modes, but predictions and capability learning require an
uninterrupted, unobstructed walking interval. Flight compensation is not validated.

## Architecture and information boundary

| Module                       | Responsibility                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `fly/echo/model.ts`          | Forward predictions, rolling identification, hypotheses, uncertainty, regulation and bounded memory.    |
| `fly/echo/controller.ts`     | Wrap an existing `FlyNeuralAdapter`; return motor proposals through the existing gate.                  |
| `fly/echo/apparatus.ts`      | Researcher-only kinematic interventions and their bounds.                                               |
| `fly/echo/checkpoint.ts`     | Closed, versioned, bounded checkpoint validation.                                                       |
| `rain/scientific/echoRig.ts` | Host-scripted excitation and interventions on the actual `DigitalFly`, with retained trial diagnostics. |

The **legacy controller** retains its preexisting `DecisionInput`, including its
body snapshot and navigation. The **new self-model** receives only a closed
`MotionObservation`: interval-local forward/lateral/vertical odometry, turn,
physiological reserve, mode, contact-validity flag, tick and time. It never
receives an absolute pose, a world object, an intervention label, a movement
gain, an external force, or a future schedule. Researcher truth stays in the
apparatus and panel. The two types are deliberately distinct.

This adds an **idealized local visual odometry/proprioception sensor** computed
from achieved body motion. It is not an implemented optical-flow retina or a
measurement of fly perception. Odometry has no additional latency; the existing
visual senses retain their existing latency. The odometric origin and heading
are arbitrary, so estimated coordinates must not be compared directly with
world coordinates. There is no privileged absolute position correction.

Accepted motor commands provide an efference copy **after `validateCommand`**.
The model predicts the next 50 ms of forward movement using the body's nominal
5 ms exponential speed response, an estimated movement gain, and an estimated
additive drift. It also predicts integrated turning from an estimated turn gain.
A refused command or intervening escape invalidates the pending prediction.
The next eligible sensor interval is compared with that frozen prediction before
learning. Interrupts still pass the same body gate.

Identification fits `observed speed = gain × nominal speed + drift` over at most
24 intervals. Gain and drift are unidentifiable without variation in motor
commands; the model explicitly reports **insufficient excitation** then. Rolling
regression, turn-response identification, residual checks and bounded updates
produce generic hypotheses; no rule names an experimental scenario. A gain is
an action-response relationship, not proof that a particular body part failed.
Sensor bias and physical displacement may be observationally indistinguishable.

All gains, thresholds, retention limits, noise levels and intervention strengths
are **engineering model choices**. They are not biological measurements or fitted
FlyBody parameters. Gain bounds are 0.2–1.6, inferred drift ±3 cm/s, rolling
excitation variance must exceed 0.025 (cm/s)², and residual RMS above 0.6 cm/s
blocks identification. Updates move 20% toward the rolling estimate.

## Uncertainty and memory

Before each prediction the model freezes its residual scale. The following
observation is checked against the nominal 90% interval (±1.645 scales), then
updates the scale by an exponentially weighted squared error. Coverage is
measured, not assumed. This is an engineering interval, not a guaranteed
calibrated posterior; correlated samples must not be treated as independent.
High residual scale or repeated failures reduce requested walking speed and add
small bounded speed probes. The `no_uncertainty` ablation disables that behavior.

Memory separates 32 recent sensory samples, 24 identification pairs, learned
parameters, and 32 episodes. Episodes retain observation, accepted action,
prediction, outcome error, parameter update, heuristic reliability, version,
seed and tick. Matching an older gain/drift hypothesis can initialize a new
update; experience may also be misleading. Inspectors get detached copies.
The reliability score is **not** a calibrated probability.

`EchoModel.checkpoint()` serializes that subsystem with a version, configuration,
context and SHA-256 checksum. Restore rejects incompatible, corrupt, malformed,
out-of-bounds or oversized state. Tests restore pending predictions and compare
future learning byte for byte under identical subsequent inputs.

**This is not a full fly or Bethesda checkpoint.** It omits the body's state,
random streams, sensory queues, city and pedestrian state. It must not be used
to impersonate continuation of the same fly after restarting a server. The
[headless life limitations](BETHESDA_CONTINUOUS_LIFE.md) still apply; there is no
new shared authoritative production service or single-writer lease.

## Frozen evaluation protocol

Development checks use seed 9173, movement gain 0.65, and a 4 × 2.5 × 4 m room.
Final evaluations use host-drawn seeds **after preregistration** and different
strengths and room sizes. The controller, apparatus, variants, metrics and
acceptance criteria are committed before final evaluation; every record binds
the producing commit and transitive fly source digest. Once these evaluation
outcomes inform changes, those conditions must be relabeled development and a
new holdout defined. This release retains its first evaluation, including failures.

Each seed contains four impairment/memory trials or six causation trials. Held-out
movement gains are 0.48, 0.57, 0.74 and 0.81, jittered by ±0.01; turn gain is
0.65 in applicable combined trials. Rooms vary from 6–7 m by 5–6 m. Low sensor
noise is 0.04–0.08 cm/s. Causation additionally includes external drift of
0.5–0.7 cm/s, combinations of drift and movement loss, strong sensory noise,
a temporary solid obstacle, and misleading sensor bias. The controller receives
none of these labels or settings. Drift is a kinematic displacement proxy, not
simulated aerodynamic wind.

The generic ECHO block carries an 8 m arena envelope; its source-bound rig draws
the smaller trial rooms above. The actual dimensions and interventions are
retained in every `echo_trials[].condition` record. These protocols use scripted
motor excitation, rather than measuring spontaneous exploration.

All motor probes alternate bounded walking speeds and turns. Baseline occupies
0–2 s, intervention 2–8 s, recovery 8–12 s. Memory trials continue through a
neutral washout, re-expose at 14–20 s, and recover to 24 s. Tracking and attribution
are scored at 4–7.5 s; early re-exposure error is scored at 14–15.5 s. Missing
detections remain null. Compensation and causal attribution are separate metrics.

| Native protocol           | Primary metric                                           | Baseline                                                  | Preregistered minimum improvement |
| ------------------------- | -------------------------------------------------------- | --------------------------------------------------------- | --------------------------------- |
| ECHO-01 `echo_impairment` | Mean absolute target-speed error, cm/s                   | Same motor probe, self-model disabled                     | 0.10 cm/s decrease                |
| ECHO-02 `echo_causation`  | Correct attribution fraction; ambiguity counts incorrect | Simple speed-residual attribution, no adaptive self-model | 0.10 increase                     |
| ECHO-03 `echo_memory`     | Early re-exposure target-speed error, cm/s               | Self-model explicitly reset at re-exposure                | 0.05 cm/s decrease                |

The preexisting R.A.I.N. compiler, registry, single-use authorization ledger,
host-drawn seeds, replay, evidence archive and criteria evaluator execute these
protocols. Eight independent seeds per design; each seed is paired across arms.
Acceptance requires the host's unchanged guards: completed runs, exact replay,
informative baseline, at least six untied seed pairs, zero command refusals,
the minimum mean paired effect, and one-sided exact sign-test p ≤ 0.05.
No threshold is sized from the held-out results. Three primary tests and nine
ablations are exploratory; p-values are unadjusted for multiplicity.

The host authors and labels the demonstrations **scripted**. They are not model
discoveries, human review, or independently replicated research. Each protocol
also runs with learning, episodic memory, or uncertainty disabled. The disabled
self-model and reset-memory controls complete the ablations. Diagnostic outputs
retain prediction error, interval coverage, false self-attribution, detection and
recovery latency, recall events, adjusted actions, checkpoint checks and actual
researcher conditions per trial. Temporal samples and trials within a seed are
not independent replicates.

```sh
npm run rain:echo:demo        # clean committed checkout; native pipeline, 12 designs
npm run rain:echo:verify      # verify seals and exact re-simulation of retained results
npm run rain:fly:verify       # existing archive; older code remains explicitly identified
npm run bethesda:life:smoke
npx vitest run src/bethesda/fly/echo/echo.test.ts
```

Initial held-out results support movement compensation and causal attribution:
mean target-speed error fell from 0.4297 to 0.1934 cm/s, and attribution accuracy
rose from 0.1417 to 0.7920. Retaining the model worsened early re-exposure error
by 0.0285 cm/s versus resetting it; ECHO-03 was not supported. Learning-disabled
ablations failed, while these evaluations do not establish additional benefit
from episodic memory or uncertainty over simpler adaptive variants. These are
exploratory simulator findings, with unadjusted tests.

See [evaluation findings and intervals](PROJECT_ECHO_RESULTS.md) and
[retained ECHO records](benchmarks/project-echo/README.md) for all outcomes.

See [completed verification and reproduction commands](PROJECT_ECHO_VERIFICATION.md).

## Scope and remaining limitations

Self-modeling is implemented and can influence the actual fly controller; success
of every scientific hypothesis is not an implementation acceptance shortcut.
Failures and inconclusive outcomes remain visible. Memory is an inspectable
mechanism, not an assertion of identity. Causal hypotheses can be wrong. Neither
synthetic generalization, interval coverage nor kinematic compensation validates
consciousness, biological embodiment, or performance of the separate MuJoCo
locomotion backend.

FlyBody-derived anatomy, Virtual Fly Brain metadata, source attribution and
licensing remain as documented in [DIGITAL_FLY.md](DIGITAL_FLY.md). No trained
FlyBody policy or restricted VFB geometry is added.
