# Project ECHO: a computational self-model for the digital fly

Project ECHO (Emergent Computational Self-Modeling) gives Bethesda's digital
fly a model of its own sensorimotor capabilities. The fly predicts what its
own movements will do, finds out when that prediction is wrong, asks whether
the cause is its body, its surroundings or its senses, revises the model when
the evidence supports it, and acts on the revised model.

The question is whether a computational organism can build measurable,
adaptive knowledge of itself through interaction with its environment. It is
**not** whether a simulated insect can be made to appear conscious. Every
result below describes a functional self-model in a reduced-order simulator
(see [Functional self-modelling is not consciousness](#functional-self-modelling-is-not-consciousness)).
The fly makes no first-person statement, and none would count as evidence.

Code: `src/bethesda/fly/echo/` (`ECHO_VERSION` is `echo-self-model/v1`), the
body's opt-in hooks `src/bethesda/fly/perturbation.ts` and
`src/bethesda/fly/selfMotion.ts`, the experiment rig
`src/rain/scientific/flyEcho.ts`, the evaluation report
`src/rain/scientific/flyEchoReport.ts`, and the panel
`src/bethesda/fly/SelfModelPanel.tsx`. The body is FlyBody's
(Vaxenburg et al. 2025, doi:10.1038/s41586-025-09029-4) and the brain
reference Virtual Fly Brain's, as [the digital fly](DIGITAL_FLY.md) describes.
ECHO adds no anatomical claim.

## Results in brief

From the registered R.A.I.N. demonstrations (sealed, preregistered, seeds
drawn after preregistration, re-simulated before admission) and the seeded
evaluation report ([docs/benchmarks/fly-echo/](benchmarks/fly-echo/README.md)).
All figures are from held-out conditions unless marked otherwise.

| Experiment | Registered result (frozen criteria)                                                                                                                                                                                                                                                          | Evaluation report (24 seeds, 95% bootstrap intervals)                                                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ECHO-01    | **Supported.** Without the self-model, path error after a hidden impairment rose from 0.036 to 0.399 (+0.362; 9 of 9 seeds; p = 0.002) ([FLY-f62ab31f…](benchmarks/fly-behavior/FLY-f62ab31f91ee122d9de1e76c/report.md))                                                                     | Path error 0.077 [0.044, 0.115] with the self-model, 0.385 [0.303, 0.463] without (24 of 24 seeds); identification error 0.9%; impairment noticed after 0.69 s on average                                                                                |
| ECHO-02    | **Inconclusive.** A motion-gated rule explained 0.567 of hidden changes correctly against the self-model's 0.891 (−0.324; 6 of 6 untied seeds; p = 0.016), short of the pilot-sized minimum effect of 0.34 ([FLY-4f0d5f10…](benchmarks/fly-behavior/FLY-4f0d5f100e1051bcfe2c8424/report.md)) | Accuracy 0.78 [0.70, 0.86] against 0.41 (motion-gated), 0.36 (self-only) and 0.32 (uncertainty disabled); false self-attribution 0.14 against 0.81–0.92; but overconfident on held-out data (expected calibration error 0.21; 0.006 on development data) |
| ECHO-03    | **Inconclusive (under-powered by design).** A reset memory concluded a returning impairment 0.82 s later (2.52 → 3.34 s; 10 of 11 untied seeds; p = 0.006), far below the host's 4 s minimum effect ([FLY-3285f03c…](benchmarks/fly-behavior/FLY-3285f03c6180b224ef22cf97/report.md))        | Reset memory: +0.65 s [0.06, 1.25] to re-identify; no benefit in path error (−0.009 [−0.041, 0.015]); with episodic memory disabled, re-identification is 0.26 s [−0.05, 0.57] slower, an interval that includes no difference                           |

The self-model's main measured value is compensation for impairments to
its own body that it is never told about (ECHO-01). Its causal attribution
generalizes partly: it is accurate and calibrated on development data, much
more accurate than simpler rules on held-out data, and overconfident there
(ECHO-02). What it remembers measurably speeds re-identification, slightly,
and does not improve the movement that follows (ECHO-03). Failures and
negative findings are listed in [Failures, negative findings and uncertainty](#failures-negative-findings-and-uncertainty).

## Architecture

### What the fly may know, and what it may not

The simulator's authoritative state (position, velocity, heading, the world,
the perturbation schedule) and the fly's estimated state are kept apart in
code:

- `echo/view.ts` is the only door from a decision's input into the
  self-model. It passes the clock, the motor program running (`mode`), the
  legs' stepping speed (proprioception), touch (the legs at an edge or against
  a solid), the self-motion sense, the sky's compass when the sun is seen,
  and the fly's own body schema (the parameter table every decision maker is
  handed). It never passes position, velocity, heading, the world, landing
  sites or anything about a perturbation.
- The self-model's modules import nothing from the simulator except types and
  that view; `echo/echo.test.ts` scans them for it, and checks that scrambling
  every privileged field of every recorded input leaves the self-model's state
  and every command byte-identical.
- The reduced-order controller underneath keeps exactly the inputs it always
  had. ECHO does not widen anything.

### The self-motion sense

`selfMotion.ts`: over each 50 ms decision period, the body's displacement in
the frame it faced at the start of the period (forward, left, up) and its
turn, with noise: 0.1 mm per period plus 5% of the reading for translation,
0.01 rad plus 5% for turning (model choices; optic flow and halteres or leg
load are what it stands for, not what it models). It is drawn from a seeded
stream of its own and exists only when the decision maker asks for it, so a
fly that does not (the city's default fly, every older experiment) runs
byte-for-byte as before: all seven kept pilots reproduce exactly
(`npm run rain:fly -- --pilot --check`). It says what moved the fly, never why.

### Perturbations

`perturbation.ts`, applied by the body and the sense only:

| Field                               | What it does                                                                                                                                 | Stands for                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `speedGain`                         | walking: the legs step as commanded, the body advances `speedGain` times as far; flight: the wings hold `speedGain` × the commanded velocity | reduced movement effectiveness    |
| `turnGain`, `turnBias`              | yaw rate = `turnGain` × command + `turnBias` while walking or flying; a saccade turns `turnGain` × its amplitude                             | altered turning response          |
| `drift`                             | an outside velocity carrying the fly: wind in the air, the surface or a push on the ground (stopping at edges and solids)                    | external wind or displacement     |
| `spin`                              | the surface turning the fly standing or walking on it                                                                                        | external turning                  |
| `flowNoise`, `flowGain`, `flowBias` | the self-motion sense only: noisier, scaled, or reading a motion that is not there                                                           | noisy or misleading measurements  |
| (rig) `ObstacleWorld`               | a box placed across the fly's path at an onset and removed later                                                                             | temporary environmental obstacles |

Episodes are scheduled by the experimenter, labelled with a cause for
scoring, and never handed to the fly. They are models of a perturbation
chosen for this simulator, not of any injury or wind.

### One decision period

`echo/selfModel.ts` runs the cycle the brief describes, every 50 ms:

1. **Observe.** The self-motion sense reports the period just ended.
2. **Estimate.** `echo/forward.ts` predicts that report from the efference
   copy (what was commanded), proprioception (the legs' speed when it was
   commanded), the fly's heading estimate and its nine beliefs: its legs'
   speed gain, turning gain and turning bias; the same for its wings; and an
   outside drift (x, z) and outside turn. With every belief innate, the
   walking prediction reproduces the reduced-order body's walking law exactly
   (a test checks 50 periods to 12 decimals). Flight is predicted only in
   settled cruise or hover. `echo/estimator.ts` is an extended Kalman filter
   (Kalman 1960) over the beliefs; a period that cannot teach (a takeoff, a
   landing, a saccade, a reflex, a touch, an edge) is predicted with wide
   spread and teaches nothing.
3. **Doubt.** The fly rescales how far it trusts its sense from how large its
   errors are against their predicted spread (`noiseScale`), and
   `echo/detector.ts` watches the errors with cumulative-sum detectors (Page
   1954): one on the normalized innovation squared, and a two-sided pair per
   component for errors small but consistent in sign.
4. **Ask why.** When a detector alarms, `echo/inquiry.ts` opens an inquiry: it
   rewinds the short-term history to where the change began and re-weighs the
   evidence under competing explanations: nothing changed; its own speed gain,
   turning gain, turning bias or several of them; an outside drift, turn or
   both; its body and its surroundings together; its sense became noisier; its
   body is back to the innate one; or a change it remembers has come back.
   Each is scored by its marginal likelihood, which charges an explanation for
   freedom it does not need. Explanations that end as the same claim about the
   body and world pool their posterior. An inquiry concludes when one claim
   passes a posterior of 0.9 after at least 8 periods (0.4 s), or unresolved
   after 8 s.
5. **Probe when the evidence cannot decide.** Walking straight, a slower step
   and a backward push predict the same thing, and so do a turning bias and a
   turning surface. When the leading explanation and its best rival on the
   other side of "is it me?" fit the evidence equally well, the fly does not
   conclude: it stops (if walking) or takes a short straight walk (if
   standing), because its own gains act only through what it commands and the
   world does not, and then weighs again.
6. **Remember.** `echo/memory.ts` keeps three stores apart: the short-term
   history (the last 80 periods, 4 s); the learned beliefs (the filter); and
   episodic memory (at most 24 episodes: what was observed, commanded,
   predicted and found, the explanation and its posterior, the beliefs before
   and after, and the fly version, self-model version, seed and time). When
   full, the least informative episode is forgotten. A remembered
   self-change becomes a hypothesis (with tight prior) the next time
   something changes.
7. **Act.** The reduced-order controller's command is the fly's intention.
   While the fly doubts itself (an inquiry open, a gain uncertain by more than
   0.12, or its sense distrusted threefold) it walks and flies at 0.6 of the
   intended speed and takes off only to escape. It may replace the intention
   with a probe. It then compensates: a leg believed half as effective is
   asked for twice the speed, up to the body's 4 cm/s; a believed turning bias
   is subtracted. The giant-fiber reflex passes through untouched.
8. **Predict.** The forward model's expectation for the coming period, from
   the revised beliefs, is held for step 1.

Every command still passes the fly's own gate (`validateCommand`); a test
drives the self-model with absurd beliefs and the gate refuses nothing.

### Variants and ablations

`ECHO_VARIANTS` (`echo/selfModel.ts`), each a `FlyNeuralAdapter`
(`echo/adapter.ts`, `EchoAdapter`) over the same reduced-order controller:

| Variant          | What it removes                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `full`           | nothing                                                                                                                   |
| `reactive`       | the self-model altogether; reads no self-motion sense; runs step for step as the reduced-order controller (a test checks) |
| `no_learning`    | predictive learning: beliefs never revised (it still predicts, errs, notices and asks)                                    |
| `no_memory`      | episodic memory: no episodes, no recall                                                                                   |
| `no_uncertainty` | uncertainty estimation: fixed trust in its sense, explanations chosen by best fit at 8 periods, no caution, no probes     |
| `naive_self`     | a simpler baseline: no outside or sensor explanations, so every unexplained change is its own                             |
| `motion_gated`   | a simpler sensorimotor baseline: a change met while moving is its own, one met standing is the world's                    |

### Determinism, cost and bounds

Everything is arithmetic in a fixed order on seeded streams; a fly stepped
5 ms or 50 ms at a time reaches the same state hash, and the self-model's
state is part of the fly's. In the 30-pedestrian city, ten simulated minutes
cost the ECHO fly 0.32 ms per city tick against 0.29 ms for the reduced-order
fly (one cloud container, Node 22; the test bounds a decision well under a
millisecond). Its state stays under 400 KB however long it lives (a test runs
30 perturbations); a checkpoint is about 150 KB.

## Experiments

Three protocols in the R.A.I.N. Lab's digital-fly backend
(`digital-fly-behavior/v3`), with the backend's whole discipline: a closed
design, host-written question and hypothesis, preregistration, a person's
authorization (or, for the demonstration's own designs only, the script's,
labelled `Scripted.DemoOperator`), seeds drawn by the host after
preregistration, two simulations per run, an exact one-sided sign test with
host-fixed guards (G1–G5), and admission only after re-simulation from
committed code. Each is a lesion study: the control arm runs the full
self-model, the treatment removes one mechanism, on matched seeds (same fly,
same placement, same hidden schedule).

All three run in the **held-out arena** (3 m across with four posts; the
self-model was developed in an open 4 m room) on the **held-out evaluation
conditions** (`ECHO_EVALUATION_CONDITIONS`, `flyEcho.ts`): strengths drawn
from bands either side of the development values, combinations of causes, a
temporary obstacle and a misleading sense. The fly walks in bouts and rests
between them; it does not fly or groom in these arenas.

**Path error**, the main behavioural measure: over 1 s windows in which the
fly walked, intended to walk and met no edge, the distance between where it
ended and where an unimpaired body following its own intentions from the same
start would have ended, over that intended path's length.

### ECHO-01: recognizing a bodily impairment

- **Question.** Can the fly detect an unfamiliar impairment through
  prediction errors and compensate without being told what changed?
- **Hypothesis (registered).** Without its self-model, the fly's walking
  strays further from its intended path after a hidden held-out impairment
  than with it. Competing: the reduced-order controller's own feedback keeps
  the path as close.
- **Protocol.** 120 s; a hidden onset at 30–40 s; one held-out impairment per
  seed: speed gain 0.35–0.45 or 0.65–0.75; turning gain 0.35–0.5 or 0.7–0.8;
  turning bias ±0.4–0.6 or ±1.0–1.4 rad/s; speed and turning gain together;
  speed gain and turning bias together. It lasts to the end.
- **Measures.** Path error after the onset (primary), over the last 40 s and
  before the onset; detection latency (onset to the first noticing);
  attribution latency (to concluding "self"); identification error (the final
  beliefs against the hidden values, separating identification from
  compensation); false alarms before the onset.
- **Registered demonstration.** Treatment: no self-model. 9 seeds, minimum
  effect 0.19 (both pilot-sized). Supported (above).

### ECHO-02: self versus external causation

- **Question.** Can the fly distinguish sensory changes caused by changes in
  its own body from externally generated ones?
- **Hypothesis (registered).** A motion-gated rule explains fewer hidden
  held-out changes correctly than the full self-model. Competing: whether the
  fly was moving when a change began is all the evidence there is.
- **Protocol.** 160 s; four episodes at about 20, 55, 90 and 125 s (±3 s),
  each 15–22 s, the last lasting to the end half the time; each drawn from:
  its own speed gain; its own turning bias; a push (0.5–0.7 or 1.1–1.4 cm/s in
  any direction); a turning surface (±0.3–0.45 or ±0.75–1.0 rad/s); a noisier
  sense (×2.5–3.5 or ×5–7); its own speed gain and a push together; a
  temporary obstacle; a misleading sense (a constant 0.5–1 cm/s read in its
  own frame). Disturbances were chosen comparable in size: a speed loss of
  about 0.9 cm/s at its walking speed against a push of 0.6–1.4 cm/s.
- **Scoring.** Each onset, and each end of a change to its body or its
  surroundings, is matched to the first inquiry the fly opened within 6 s of
  it and scored by that inquiry's conclusion. An obstacle is answered
  correctly by anything but blaming its own body (it should not learn from
  touched steps at all). A misleading sense is scored apart: no sense this fly
  has can tell it from a push.
- **Measures.** Attribution accuracy (primary), false self-attribution of
  external changes, the Brier score of its stated confidence, path error over
  the run, missed changes, the 90% interval coverage of its predictions.
- **Registered demonstration.** Treatment: motion-gated. 10 seeds, minimum
  effect 0.34 (pilot-sized). Inconclusive (above).

### ECHO-03: learning retained through time

- **Question.** Does accumulated experience improve the fly's ability to
  predict and regulate its own behaviour?
- **Hypothesis (registered).** A self-model reset to an innate one before a
  remembered held-out impairment returns takes longer to conclude that it
  changed itself. Competing: learning from scratch is as fast as recognizing.
- **Protocol.** 245 s: impairment A (25–65 s), normal (65–90 s), another
  impairment B (90–125 s), normal, A again within 5% of its first values
  (150–185 s), normal, then an unfamiliar combination C (from 210 s). The
  reset arm replaces the self-model with an innate one at 145 s
  (`EchoAdapter.reset`, on record in the adapter's state).
- **Measures.** Re-exposure latency (primary) and path error over the first
  10 s of A's return; the same for A's first appearance (a control: no arm
  differs before the reset); path error in the unfamiliar C; recalls, and
  recalls concluded during C (which nothing matches).
- **Registered demonstration.** Treatment: memory reset. Its pilot found no
  seed count that passes with 0.9 probability, so it runs at the host's
  largest seed count (16) and the host's minimum effect (4 s), labelled
  under-powered before it ran. Inconclusive, as expected (above).

### Checkpoint recovery

The persistent-identity question is answered narrowly. The self-model's
checkpoint (`echo/checkpoint.ts`, `echo-checkpoint/v1`) holds its whole
state, sealed by a digest; `parseEchoCheckpoint` refuses another self-model
version, fly version or variant, a changed byte, or stores over their bounds,
saying why. Restored into the same running fly it continues exactly: in the
evaluation, four held-out runs checkpointed and restored at 147.5 s ended with
the same body and the same self-model as the same runs left alone, and a test
checks the same. Every replacement is recorded in the adapter's state.

It is labelled experimental because it holds the self-model only: not the
body, the controller underneath, the senses' pending frames or any random
stream. Restored into another fly it gives that fly this self-model; it does
not bring this fly back. The city's fly is still not a persistent individual
across restarts ([continuously living Bethesda](BETHESDA_CONTINUOUS_LIFE.md)
lists what that would need), and nothing here claims it is.

## Scientific validation

1. **Metrics and criteria before held-out data.** Every metric is defined in
   `FLY_METRICS` and computed by the rig. Each demonstration's treatment,
   metric and direction were written before any held-out run. The registered
   criteria are the backend's frozen sign-test criteria.
2. **Deterministic baselines.** The reactive variant runs step for step as the
   reduced-order controller; the default fly is byte-identical with the new
   hooks (all seven pilots reproduce).
3. **Development and evaluation separated.** The self-model was built on the
   development conditions (one strength each: speed gain 0.55, turning gain
   0.6, turning bias 0.8 rad/s, a 0.9 cm/s push, a 0.6 rad/s spin, a sense ×4
   noisier), in the open 4 m room, on development seeds
   (SHA-256("echo-development/v1|" + counter)), with
   `scripts/echo-develop.ts`. Evaluation strengths come from bands that
   exclude the development values (a test checks), plus combinations, an
   obstacle and a misleading sense that development never used, in another
   arena, on other seeds.
4. **Frozen configuration.** The self-model was frozen at commit `422f1df`,
   before any held-out run. Nothing in `src/bethesda/fly/echo/`, the body or
   the sense has changed since (`git diff 422f1df -- src/bethesda/fly/echo
src/bethesda/fly/fly.ts src/bethesda/fly/perturbation.ts
src/bethesda/fly/selfMotion.ts` is empty). After it, only the host
   minimum effects (set from the pilots' floors, the backend's rule), the
   demonstration sizes (the pilots') and a checkpoint hook in the rig changed.
   The pilots ran on held-out conditions and public pilot seeds; they sized,
   they did not tune.
5. **Independent seeded trials.** Registered runs on host-drawn seeds; the
   report on 24 declared evaluation seeds, two simulations per registered run.
6. **Failures recorded.** Below, and in the report and the archive, which
   keep inconclusive results and refusals.

Development tuning, in the open, before the freeze: the self and drift
process noise were lowered after the filter silently absorbed a speed loss
into a drift belief; signed detectors were added after slow walking hid small
impairments; specific hypotheses replaced broad ones and the "fits equally
well, so probe" rule was added after confounded walking-only evidence produced
confident wrong conclusions; explanations making the same claim were pooled
after duplicated hypotheses left inquiries unresolved; the flight model's
settle time and hover flag were corrected after nominal flight raised false
alarms; and the sun compass was added after wind in flight kept being
re-detected. Each was found and checked on development data only.

## Failures, negative findings and uncertainty

- **Overconfidence on held-out causes (ECHO-02).** On development data the
  self-model's stated confidence matched its accuracy (expected calibration
  error 0.006). On held-out data it did not (0.21): conclusions stated at
  0.90–0.97 were right 62% of the time. Most errors are the combined
  self-and-push condition answered as a push alone (26 of 33), and external
  changes answered as body and surroundings together (6 of 52). Accuracy fell
  from 0.99 (development) to 0.78 (held-out).
- **Compensation is bounded by the body (ECHO-01).** With speed and turning
  impaired together, the fly identified its gains to about 1% and still
  strayed by 0.12–0.19 of its path, because the leg speed its compensation
  asks for exceeds the body's 4 cm/s. Identification and compensation are
  different things, and the report keeps them apart.
- **A cost of learning when nothing is wrong.** Before any impairment the
  self-model's path error is 0.013 against the reactive controller's 0.0005:
  its beliefs wander within their noise, and it compensates for the wander.
- **Memory helps little (ECHO-03).** Episodic memory shortens re-identification
  by a fraction of a second and does not improve the movement that follows; in
  10 of 24 held-out seeds the reset self-model's early path error was lower.
  A recalled episode's tight prior can also win confounded evidence, which the
  pooled claims and probes mitigate but do not remove; 0.21 recalls per run
  were concluded during the unfamiliar change, which nothing matched.
- **Uncertainty earns little in ECHO-01, much in ECHO-02.** Disabling
  uncertainty estimation raised impaired path error by only 0.008 [0.001,
  0.019], but dropped attribution accuracy to 0.32 and made the fly blame
  itself for 83% of external changes.
- **A misleading sense is not detected.** A constant motion read that is not
  there was explained as a push in all 7 held-out onsets (never as its own
  body). With one self-motion sense, a sensor offset and an outside drift are
  observationally equivalent; the protocol scores it apart for that reason.
- **The held-out arena was a weak test of a new environment.** The walking fly
  seldom reached its walls or posts: the arena changed the outcome in 2, 3 and
  9 of 24 seeds of the three schedules. Generalization to unseen strengths and
  combinations is tested; generalization to unseen environments mostly is not.
- **Registered effects below their minimum.** ECHO-02 and ECHO-03 came out
  inconclusive by their frozen criteria; their minimum effects are large
  because each seed draws its own condition and the pilots' null arms vary
  widely. They were not lowered.
- **The city's wind is mostly blamed on the sense.** In wind the self-model
  concluded 80 of 106 inquiries in an hour as its own sense misleading it
  ([In Bethesda](#in-bethesda)): its explanations have no wind, and its
  drift cannot represent what the body's groundspeed hold leaves of one.
- **Uncertainty of the numbers.** Intervals are bootstrap intervals over
  seeds of one deterministic simulator, and sign-test p-values say how
  consistently the arms differ across seeds. Neither says anything about a
  population of flies.

## Assumptions and limitations

- The fly is the reduced-order simulator of [the digital fly](DIGITAL_FLY.md):
  kinematic walking and flight, no aerodynamics, no contact forces, no
  neurons. ECHO's compensation acts on that body's abstract movement gains.
  It is not validated biological motor control, and FlyBody's physics
  (`fly-physics/`) does not run in these experiments.
- The self-model knows its innate body schema exactly (the parameter table
  and the sense's nominal noise), which no real nervous system is handed.
- The forward model is exact for walking and approximate for flight; it does
  not model the walking path's curvature from the velocity tracker in flight,
  so flight teaches only in settled cruise and hover.
- The fly's heading estimate is its sensed turns added up, held by the sun
  when it sees it. Indoors it drifts, which limits how well it can tell a
  world-fixed push from one that turns with it.
- Explanations are a fixed, finite list. A cause outside it (a sense that
  lies in a structured way, two impairments arriving within seconds) is
  forced into one of them.
- Perturbations are the experimenter's simple models. No study supports their
  form for a real fly, and none is claimed.
- Episodic memory is a list of summaries with a recall rule, not a model of
  the mushroom body or any memory system.

## In Bethesda

The city's fly keeps the reduced-order controller unless asked. The fly
panel's **Controller** choice places a new fly with the ECHO controller on its
bench at the city's current tick (`CityFly` with `controller: "echo"`); it
never changes the fly that was living, and says that the new fly carries
nothing over. Everything else is the city fly's: its senses, energy,
feeding, navigation and the people who notice it. Nothing is perturbed in the
city, so in still air any change the self-model concludes there is a
misreading of noise: in a simulated hour it opened one inquiry.

From `digital-fly/8` the city has a wind ([the digital fly](DIGITAL_FLY.md#wind)),
the first outside cause there, and the self-model mostly misreads it. Over
the first simulated hour of the default city the ECHO fly flew for 163 s
(1,076 s in still air), cautious for 131 s of them; it opened 106 inquiries
and concluded 80 of them as its own sense misleading it, 11 as an outside
push, 8 as both and 2 as its body. Its outside drift is one velocity fixed in
the world, but its body holds its groundspeed along its heading, so only the
crosswind part of the wind moves it, and that part turns as the fly turns: no
belief it can hold explains it. It does not feel the wind either: airflow is
not in its view (`view.ts`).

The panel's **Self-Model** section is read-only and shows the fly's own
estimates (predicted against sensed motion, prediction error, trust in its
sense and calibration, its believed gains and capability, the open inquiry
with its leading explanations, recently revised beliefs, remembered
episodes, the active configuration and any replacement of the self-model)
apart from **ground truth only researchers see** (actual movement, the
perturbation in force). Opening it changes nothing the fly does.

The headless runner takes the same choice:
`node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --ticks 100 --controller echo`,
and `HeadlessBethesdaLife.selfModelCheckpoint()` returns the experimental
checkpoint. Both remain in memory only.

## Functional self-modelling is not consciousness

What ECHO shows, where it shows anything, is functional: the fly maintains
and updates a computational model of its own sensorimotor capabilities,
detects when that model fails, attributes the failure to its body, its
surroundings or its senses better than simpler rules do, acts more cautiously
when the model is in doubt, and keeps some of what it learned. These are
measurable properties of a program. They are not evidence of awareness,
experience, feeling or a point of view, and the project does not test for
those: no measurement here could distinguish a system that has them from one
that does not. "Self" in this document means the variables the program
attributes changes to, nothing more.

## Reproduce

```sh
npx vitest run src/bethesda/fly/echo src/rain/scientific/flyEcho.test.ts   # the self-model and the rig
node scripts/run-ts.mjs scripts/echo-develop.ts --seeds 8                  # development runs (not evidence)
npm run rain:fly -- --pilot --check                                        # every pilot reproduces exactly
node scripts/run-ts.mjs scripts/echo-evaluate.ts --check                   # the evaluation report reproduces
npm run rain:fly:verify                                                    # re-simulate the archived records
```

## Tests

`src/bethesda/fly/echo/echo.test.ts`:

- the version, every parameter a fixed model choice, the variants the
  contract names, no descriptor claiming awareness;
- the forward model reproducing the body's walking law to 12 decimals, and
  linear in a gain;
- perturbations refused when malformed, combined within their windows,
  slowing, turning and carrying the body while the legs step as commanded,
  and faults of the sense changing only what the fly feels;
- isolation: no self-model module imports the world, the perturbations or the
  body or reads position, velocity or heading, and scrambling every privileged
  field of 600 recorded inputs changes neither its state nor one command;
- a hidden impairment noticed, blamed on the legs, learned and compensated; a
  push at rest blamed on the outside; a noisier sense blamed on the sense,
  with trust lowered and caution engaged; calibrated 50% and 90% intervals and
  no conclusion where nothing changed; no revision with learning disabled;
  one state hash per seed whatever the step size;
- the reactive variant step for step the reduced-order controller, and a fly
  without the hooks drawing nothing new;
- a probe when walking cannot tell a bias from a turning surface, and every
  command through the gate under absurd beliefs;
- bounded stores over 30 perturbations, a byte-for-byte checkpoint round trip,
  exact continuation after restoring its own checkpoint, refusals of another
  version, variant or changed byte, a recorded reset, a recalled impairment;
- a decision well under a millisecond, and a state under 400 KB.

`src/rain/scientific/flyEcho.test.ts`: evaluation bands that exclude the
development values; registered blocks on evaluation conditions only, in the
held-out arena; one schedule per seed; the three demonstrations compiling,
with their limitations, and an unknown variant refused; an ECHO block run
deterministically with no gate refusals; no path error for an unimpaired
body; scoring by the fly's own conclusions; the temporary obstacle; the
recorded reset. `cityFly.test.ts` and `life/headless.test.ts` check the city
and the headless runner with the ECHO controller: an unchanged city hash, no
gate refusals, nothing concluded where nothing changed, the labelled
checkpoint. `fly.test.ts` holds the ECHO pilots, demonstrations and host
minimum effects to their pilot files.

To run a registered ECHO experiment of your own, write a `rain-fly-design/v3`
with an `echo_*` treatment and follow the backend's review
([the lab guide](RAIN_LAB_BETHESDA.md#the-digital-fly-backend)).

## References for the mechanisms

The mechanisms borrow from: the reafference principle (von Holst &
Mittelstaedt 1950, doi:10.1007/BF00622503); efference copy in Drosophila
visuomotor processing (Kim, Fitzgerald & Maimon 2015,
doi:10.1038/nn.4083), cited for the existence of the principle in flies,
not for this implementation; the Kalman filter (Kalman 1960,
doi:10.1115/1.3662552); and the cumulative-sum test (Page 1954,
doi:10.1093/biomet/41.1-2.100). None of them is evidence that a fly works the
way ECHO does.
