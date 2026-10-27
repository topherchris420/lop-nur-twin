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

From `echo-self-model/v3` the self-model also has simple functional analogues
of three indicator properties from the assessment of Butlin, Long et al. 2023
(arXiv:2308.08708): a workspace that holds one content at a time and
broadcasts it to what acts, a model of its own attention that it uses to
control that attention, and a second look at its own conclusions before it
commits to them ([Indicator properties](#indicator-properties)). They were
built so that what they do can be measured and ablated (ECHO-04, ECHO-05).
That assessment treats such properties as evidence only under computational
functionalism, a contested view, and holds that no current system is a
strong candidate. A few hundred lines of arithmetic in a reduced-order
simulator are not one either.

Code: `src/bethesda/fly/echo/` (`ECHO_VERSION` is `echo-self-model/v3`), the
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
evaluation report ([docs/benchmarks/fly-echo/](benchmarks/fly-echo/README.md)),
both of `echo-self-model/v3`; the registered runs are from `352fafd`, and the
archive keeps every earlier run. All figures are from held-out conditions
unless marked otherwise.

| Experiment | Registered result (frozen criteria)                                                                                                                                                                                                                                                                                                                                                                                   | Evaluation report (24 seeds, 95% bootstrap intervals)                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ECHO-01    | **Supported.** Without the self-model, path error after a hidden impairment rose from 0.073 to 0.370 (+0.297; 9 of 9 seeds; p = 0.002) ([FLY-3dedfd1e…](benchmarks/fly-behavior/FLY-3dedfd1e08238befa3a2cd09/report.md))                                                                                                                                                                                              | Path error 0.083 [0.047, 0.125] with the self-model, 0.385 [0.303, 0.463] without (24 of 24 seeds); identification error 0.9%; impairment noticed after 0.69 s on average                                                                                         |
| ECHO-02    | **Supported.** A motion-gated rule explained 0.537 of hidden changes correctly against the self-model's 0.919 (−0.381; 10 of 10 untied seeds; p = 0.001), beyond the pilot-sized minimum effect of 0.36 ([FLY-ea1f81b9…](benchmarks/fly-behavior/FLY-ea1f81b92313cd532b36b4a8/report.md)). Its first run, on `v1`, was inconclusive ([FLY-4f0d5f10…](benchmarks/fly-behavior/FLY-4f0d5f100e1051bcfe2c8424/report.md)) | Accuracy 0.89 [0.83, 0.94] against 0.42 (motion-gated), 0.34 (self-only) and 0.32 (uncertainty disabled); false self-attribution 0.08 against 0.81–0.85; still overconfident on held-out data (expected calibration error 0.12; 0.013 on development data)        |
| ECHO-03    | **Inconclusive (under-powered by design).** A reset memory concluded a returning impairment 1.60 s later (3.49 → 5.08 s; 11 of 12 untied seeds; p = 0.003), below the host's 3 s minimum effect ([FLY-aff10dec…](benchmarks/fly-behavior/FLY-aff10dec2ec287b28e76c74e/report.md))                                                                                                                                     | Reset memory: +0.22 s [−0.42, 0.73] to re-identify; no clear effect on path error (+0.006 [−0.027, 0.039]); with episodic memory disabled, re-identification is 0.54 s [0.23, 0.95] slower                                                                        |
| ECHO-04    | **Inconclusive (under-powered by its pilot).** Without the workspace the busy fly concluded 0.69 s sooner on average (18.26 → 17.58 s; 2 seeds slower, 3 faster, 11 tied; p = 0.81), against the host's 30 s minimum effect ([FLY-14084ba1…](benchmarks/fly-behavior/FLY-14084ba1f010fb490c4e0d55/report.md))                                                                                                         | Without the workspace: 1.00 s [0.29, 1.79] slower to conclude (8 seeds slower, 1 faster, 15 tied); without the attention schema 0.09 s [0, 0.25]                                                                                                                  |
| ECHO-05    | **Inconclusive (under-powered by its pilot).** Without the second look the Brier score was 0.132 against 0.099 (+0.032; 11 of 16 seeds; p = 0.105), below the host's 0.2 minimum effect ([FLY-bdfb8327…](benchmarks/fly-behavior/FLY-bdfb8327413f5007cc987738/report.md))                                                                                                                                             | Without it: Brier score +0.088 [0.022, 0.163] (19 of 24 seeds), accuracy −0.097 [−0.175, −0.029], expected calibration error 0.20 against 0.12; on the report's development seeds it did slightly worse ([Failures](#failures-negative-findings-and-uncertainty)) |

The self-model's main measured value is compensation for impairments to
its own body that it is never told about (ECHO-01). Its causal attribution
generalizes partly: it is accurate and calibrated on development data, much
more accurate than simpler rules on held-out data (ECHO-02), and still
overconfident there, less so with its second look (ECHO-05). What it
remembers measurably speeds re-identification, slightly, and does not improve
the movement that follows (ECHO-03). Its workspace saves about a second on a
busy fly in the evaluation report, too little for its registered test, which
went the other way; its attention schema does almost nothing here (ECHO-04). Failures and
negative findings are listed in [Failures, negative findings and uncertainty](#failures-negative-findings-and-uncertainty).

## Architecture

The opt-in [immortal-organism research extension](ECHO_IMMORTAL_ORGANISM.md)
composes this self-model with the existing mushroom-body controller and
recoverable tissue proxies in separate research individuals. A smaller
maintenance-only continuation preserves an existing ECHO adapter exactly.
Neither is selected by the live runner; see the
[original-individual migration plan](ECHO_IMMORTAL_MIGRATION.md) and the
extension's explicit scientific limitations. The
[organism continuation](ECHO_ORGANISM_CONTINUATION.md) is the reviewed path
for the deployed individual itself: its own v3 self-model and controller,
kept byte for byte, with the mushroom body, olfaction and physiology added
beside them. It is not deployed until its cutover is approved.

### What the fly may know, and what it may not

The simulator's authoritative state (position, velocity, heading, the world,
the perturbation schedule) and the fly's estimated state are kept apart in
code:

- `echo/view.ts` is the only door from a decision's input into the
  self-model. It passes the clock, the motor program running (`mode`), the
  legs' stepping speed (proprioception), touch (the legs at an edge or against
  a solid), the self-motion sense, the sky's compass when the sun is seen,
  the air its antennae feel going by (its speed and the bearing it comes
  from), and the fly's own body schema (the parameter table every decision
  maker is handed). It never passes position, velocity, heading, the world,
  the wind, landing sites or anything about a perturbation.
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
chosen for this simulator, not of any injury or wind. A perturbation's
`drift` in the air is added to what the wings hold; the city's wind is not
a perturbation, and the body meets it by its own rule (next section).

### The air

From `echo-self-model/v2` the self-model tracks the wind as its antennae feel
it (the city's wind, [the digital fly](DIGITAL_FLY.md#wind)). Two beliefs, the
air's velocity in the fly's own frame, join the nine, and the forward model
lets the air move the fly only as the body does (`fly.ts`, part of the body
schema the fly is given):

- standing, walking or hovering, the wind moves it not at all, and its
  antennae feel all of it (less its own motion over the ground);
- in cruise its wings hold its groundspeed along its heading, so the wind
  across its heading carries it and the wind along it only changes the air
  speed its antennae feel from ahead; beyond its wings' limit, or with a
  tailwind faster than its command (no air from ahead at all), the wind
  carries it along its heading too. Its antennae tell it which, at each
  period's end;
- its air velocity follows a change in the wind only after the body's
  flight velocity time constant, so while it catches up it goes further than
  its wings hold: that constant times the change in the air going by between
  the period's two ends, as its antennae felt it. For the body's velocity
  tracker that is exact, short of its acceleration limit, whether the wind
  rises in a gust or steps at a building's lee;
- the antennae's reading at a period's end says what the wind is, less what
  the body has yet to catch up with. The fly takes that from how fast the air
  going by has been changing over its last readings (never from its own
  beliefs, which that rate feeds: taken from them, the loop diverged on
  development data), and after a step (the air going by changed by more than
  `airSettleMS` in one period) the reading revises nothing.

Each reading of the antennae revises the wind beliefs as the self-motion
sense revises the rest (`feelAir` in `estimator.ts`). The air changes as it
will (`windProcessSd`, whether or not a period teaches), and the air at a
surface is not the air aloft: each takeoff and landing widens the belief
again (`windPriorSd`). An inquiry gains one explanation, that the wind
changed by more than the fly expected (`external:wind`). The wind is
followed, not learned: it is left out of what makes an episode memorable
and out of the log of revised beliefs, unless the conclusion was that the
wind changed.

Until its antennae first feel the air move, the fly takes the air to be
still, with no doubt: the wind beliefs stay 0 with no spread and every
prediction is the one `echo-self-model/v1` made. In a world without wind (every
arena, every pilot and every registered block) the self-model runs as it
did: twenty arena runs of both versions (walking and flying flies, impaired,
pushed and with a noisier sense) give identical behaviour and beliefs, and
the pilots and the evaluation report reproduce their results. Each number
the air adds is derived from the city's wind model (`weather.ts`) and stated
in `ECHO_PARAMS`, not fitted.

### One decision period

`echo/selfModel.ts` runs the cycle the brief describes, every 50 ms:

1. **Observe.** The self-motion sense reports the period just ended, and the
   antennae how the air goes by.
2. **Estimate.** `echo/forward.ts` predicts that report from the efference
   copy (what was commanded), proprioception (the legs' speed when it was
   commanded), the fly's heading estimate and its eleven beliefs: its legs'
   speed gain, turning gain and turning bias; the same for its wings; an
   outside drift (x, z) and outside turn; and the wind (x, z) ([The air](#the-air)). With every belief innate, the
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
   both; once it has felt the air move, a change in the wind beyond what it
   expected; its body and its surroundings together; its sense became noisier; its
   body is back to the innate one; or a change it remembers has come back.
   Each is scored by its marginal likelihood, which charges an explanation for
   freedom it does not need. Explanations that end as the same claim about the
   body and world pool their posterior. An inquiry may conclude when one claim
   passes a posterior of 0.9 after at least 8 periods (0.4 s), or unresolved
   after 8 s. It then takes a second look: it acts on the claim at once
   (adopting its beliefs) but weighs it again on 20 fresh periods (1 s) before
   it commits. It commits if the same claim still wins, revises if another
   does, and keeps asking if none does. The conclusion it states carries the
   posterior after the second look.
5. **Probe when the evidence cannot decide.** Walking straight, a slower step
   and a backward push predict the same thing, and so do a turning bias and a
   turning surface. When the leading explanation and its best rival on the
   other side of "is it me?" fit the evidence equally well, the fly does not
   conclude: it stops (if walking) or takes a short straight walk (if
   standing), because its own gains act only through what it commands and the
   world does not, and then weighs again. With a workspace it asks only
   while its inquiry holds the workspace.
6. **Remember.** `echo/memory.ts` keeps three stores apart: the short-term
   history (the last 80 periods, 4 s); the learned beliefs (the filter); and
   episodic memory (at most 24 episodes: what was observed, commanded,
   predicted and found, the explanation and its posterior, the beliefs before
   and after, and the fly version, self-model version, seed and time). When
   full, the least informative episode is forgotten. A remembered
   self-change becomes a hypothesis (with tight prior) the next time
   something changes.
7. **Attend.** `echo/workspace.ts`: the open inquiry, the legs' touch, a
   sudden change in the air and the controller's intention (an efference
   copy, with the fly's hunger behind its pursuit of food) each bid for the
   workspace, and one content holds it ([Indicator properties](#indicator-properties)).
   `echo/attentionSchema.ts` learns how the fly's attention behaves and
   shields an inquiry it expects to be interrupted.
8. **Act.** The reduced-order controller's command is the fly's intention.
   While the fly's inquiry holds its workspace, the controller's routine
   changes of activity wait: a walking fly keeps walking, and a standing fly
   neither grooms nor takes off (it may start to walk, which is how its steps
   are seen).
   While the fly doubts itself (an inquiry open, a gain uncertain by more than
   0.12, or its sense distrusted threefold) it walks and flies at 0.6 of the
   intended speed and takes off only to escape. It may replace the intention
   with a probe. It then compensates: a leg believed half as effective is
   asked for twice the speed, up to the body's 4 cm/s; a believed turning bias
   is subtracted. The giant-fiber reflex passes through untouched.
9. **Predict.** The forward model's expectation for the coming period, from
   the revised beliefs, is held for step 1.

Every command still passes the fly's own gate (`validateCommand`); a test
drives the self-model with absurd beliefs and the gate refuses nothing.

### Variants and ablations

`ECHO_VARIANTS` (`echo/selfModel.ts`), each a `FlyNeuralAdapter`
(`echo/adapter.ts`, `EchoAdapter`) over the same reduced-order controller:

| Variant               | What it removes                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `full`                | nothing                                                                                                                   |
| `reactive`            | the self-model altogether; reads no self-motion sense; runs step for step as the reduced-order controller (a test checks) |
| `no_learning`         | predictive learning: beliefs never revised (it still predicts, errs, notices and asks)                                    |
| `no_memory`           | episodic memory: no episodes, no recall                                                                                   |
| `no_uncertainty`      | uncertainty estimation: fixed trust in its sense, explanations chosen by best fit at 8 periods, no caution, no probes     |
| `naive_self`          | a simpler baseline: no outside or sensor explanations, so every unexplained change is its own                             |
| `motion_gated`        | a simpler sensorimotor baseline: a change met while moving is its own, one met standing is the world's                    |
| `no_workspace`        | the workspace: each process acts on its own, nothing is broadcast or held, and so no attention schema                     |
| `no_metacognition`    | the second look: it commits to a conclusion as soon as its posterior is high enough                                       |
| `no_attention_schema` | the model of its own attention: the workspace runs on its bids alone and never shields an inquiry                         |

### Indicator properties

Butlin, Long et al. 2023 derive indicator properties from scientific theories
of consciousness and ask which an artificial system has. ECHO implements
simplified versions of a few. "Functional analogue" below means a mechanism
that does, in this simulator, what the property describes, at the scale of a
few parameters. It is never a claim that the property is met in the sense
the theories intend, or that it makes the fly aware of anything.

**The workspace** (`echo/workspace.ts`; GWT, Baars 1988, Dehaene & Naccache
2001). Every decision, these bid with a salience:

| Content                                                        |     Salience |
| :------------------------------------------------------------- | -----------: |
| a hazard (a surface ahead, an escape)                          |            3 |
| touch (an edge or a solid)                                     |          1.5 |
| a landing                                                      |          1.3 |
| a sudden change in the air, felt standing or in settled flight |          1.2 |
| a voluntary takeoff                                            |          1.1 |
| the open inquiry into its own movement                         |            1 |
| grooming                                                       |          0.7 |
| flying                                                         |          0.6 |
| food                                                           | 0.5 + hunger |
| walking or resting                                             |          0.3 |

The values are model choices: hazards above everything, the fly's senses'
news above its inquiry, and a takeoff just above it, so that an urge to fly
interrupts self-examination unless the fly controls its attention. A bid
enters an empty workspace at 0.5 or more, and takes it from what holds it
only by more than 5%. What holds it lets go below 0.25. Holding the
workspace is broadcast to what acts: the inquiry asks its questions only
while it holds the workspace, and the controller's routine changes wait.

**The attention schema** (`echo/attentionSchema.ts`; AST, Graziano & Webb
2015). From its own experience the fly learns, over about a minute, how often
each kind of content takes its workspace, and how long each holds it. From
that it predicts how long its focus will last and what will take it next. It
shields an inquiry when it expects at least a 20% chance that something it
could hold off takes the workspace before the inquiry is done. "Done" means
the longer of the time its inquiries tend to hold its attention and the
evidence still needed. Shielded, a rival it may hold off needs twice the
inquiry's bid. Hazards, touch and the air are never held off.

**The second look** (`selfModel.ts`, step 4; metacognitive monitoring, HOT-2;
Fleming & Lau 2014). Its one parameter (20 periods) is the span after which
an undecided inquiry already asks for a probe. It was set by that principle,
not tuned ([Scientific validation](#scientific-validation)).

What it holds of each indicator property, by our reading:

| Property                                                         | ECHO                                                                                                                 |
| :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| AE-2, a model of output-input contingencies used in control      | the forward model of its own movement, used to compensate (since v1): its main function                              |
| PP-1, input modules using predictive coding                      | partly: it predicts its self-motion sense and learns from the error, but no input module is built that way           |
| HOT-2, metacognitive monitoring of perceptual reliability        | partly: it estimates how far to trust its sense (since v1), and takes a second look at its conclusions (v3)          |
| HOT-3, belief formation guided by that monitoring                | partly: distrust of its sense makes it cautious, and a second look can revise a conclusion                           |
| GWT-1, specialized systems in parallel                           | partly: four kinds of process bid, but the controller below is one program                                           |
| GWT-2, a limited-capacity workspace with selective attention     | a functional analogue: one content, by salience, with ignition and hysteresis                                        |
| GWT-3, global broadcast                                          | partly: what holds the workspace reaches action selection and the inquiry, not navigation or the senses              |
| GWT-4, state-dependent attention, querying modules in succession | partly: the inquiry's probes run in turn only while it holds the workspace, and the attention schema shields it      |
| AST-1, a predictive model of its attention that controls it      | a functional analogue: learned capture rates and dwell, used to shield                                               |
| AE-1, agency: learning from feedback to pursue competing goals   | partly: the controller pursues food and shade, and the mushroom body learns odours (Study C), but ECHO adds no goals |
| RPT-1/2, HOT-1, HOT-4                                            | absent: no recurrent or generative perception, no quality space                                                      |

**Where it shows.** The fly panel's Self-Model section and `/live` show what
the fly attends to, whether it is shielding that, its open inquiry, and its
last conclusion with its stated confidence and what a second look made of it.

### Determinism, cost and bounds

Everything is arithmetic in a fixed order on seeded streams; a fly stepped
5 ms or 50 ms at a time reaches the same state hash, and the self-model's
state is part of the fly's. In the 30-pedestrian city, ten simulated minutes
cost the ECHO fly 0.32 ms per city tick against 0.29 ms for the reduced-order
fly (one cloud container, Node 22; the test bounds a decision well under a
millisecond). Its state stays under 400 KB however long it lives (a test runs
30 perturbations); a checkpoint is about 150 KB.

## Experiments

Five protocols in the R.A.I.N. Lab's digital-fly backend
(`digital-fly-behavior/v3`), with the backend's whole discipline: a closed
design, host-written question and hypothesis, preregistration, a person's
authorization (or, for the demonstration's own designs only, the script's,
labelled `Scripted.DemoOperator`), seeds drawn by the host after
preregistration, two simulations per run, an exact one-sided sign test with
host-fixed guards (G1–G5), and admission only after re-simulation from
committed code. Each is a lesion study: the control arm runs the full
self-model, the treatment removes one mechanism, on matched seeds (same fly,
same placement, same hidden schedule).

All five run in the **held-out arena** (3 m across with four posts; the
self-model was developed in an open 4 m room) on the **held-out evaluation
conditions** (`ECHO_EVALUATION_CONDITIONS`, `flyEcho.ts`): strengths drawn
from bands either side of the development values, combinations of causes, a
temporary obstacle and a misleading sense. The fly walks in bouts and rests
between them; it does not fly or groom in these arenas, except in ECHO-04's.

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
- **Registered demonstration.** Treatment: motion-gated. 12 seeds, minimum
  effect 0.36 (both pilot-sized). Supported (above). Its first run, on `v1`
  with 10 seeds and a minimum of 0.34, was inconclusive.

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
  largest seed count (16) and the host's minimum effect (3 s; 4 s before
  `v3`), labelled under-powered before it ran. Inconclusive, as expected
  (above).

### ECHO-04: attention, a workspace and a model of it

- **Question.** Does holding one content in a workspace, broadcasting it and
  modelling its own attention let a fly with competing urges find out sooner
  what changed in its body?
- **Hypothesis (registered).** Without its workspace, a fly that often takes
  off and grooms takes longer to conclude that it changed itself after a
  hidden held-out impairment. Competing: its inquiry gets the evidence it
  needs whenever the fly walks, so a workspace changes nothing.
- **Protocol.** ECHO-01's schedule and held-out impairments, on a busy fly
  (`busy` block): voluntary takeoff and grooming at 0.5 per second each
  (otherwise off in these arenas). The rates were set on the development
  conditions, far above the controller's own (a takeoff at 0.03 per second),
  so that urges meet the fly's inquiries often enough to measure.
- **Measures.** Time from the onset to concluding "self" (primary); a fly
  that never does counts the rest of the run, so a failure is never left
  out. Also the identification error, and the path error after the onset.
- **Doses.** No workspace (the demonstration's treatment), or no attention
  schema. In development (48 seeds) the workspace saved 1.3 s on average
  (23 seeds faster, 1 slower, 24 tied). The attention schema saved 0.03 s
  (4 faster, 1 slower, 43 tied): there the inquiry already outbids every
  content the schema could hold off except a takeoff (these arenas have no
  food). It is tested as built, not tuned toward an effect.
- **Registered demonstration.** Treatment: no workspace, sized by its pilot.
  Written before the pilot ran: other ECHO latencies have host minimums of
  3–4 s, because each seed draws its own condition, so a 1.3 s effect may
  leave it under-powered. Its pilot found no seed count that passes with 0.9
  probability (a floor of 30 s), so it ran at 16 seeds and the host's 30 s
  minimum effect. Inconclusive (above), and the other way: 3 of its 5 untied
  seeds concluded sooner without the workspace.

### ECHO-05: a second look at its own conclusions

- **Question.** Does weighing a conclusion again on fresh evidence before
  committing to it make the fly's stated confidence more accurate?
- **Hypothesis (registered).** A fly that commits at once has a higher Brier
  score on hidden held-out changes than one that takes a second look.
  Competing: the evidence that made the first answer likely also makes the
  second look agree, so it only delays the same answers.
- **Protocol.** ECHO-02's block, schedule and scoring.
- **Measures.** The Brier score (primary); accuracy, and the calibration
  table of each arm in the evaluation report.
- **Disclosure.** The second look was designed after ECHO-02's held-out
  results were published (overconfident on combined causes: expected
  calibration error 0.21). These conditions are therefore not naive for it,
  though nothing was tuned on them. On development data (16 seeds) it raised
  accuracy from 0.991 to 1.000 and lowered the Brier score from 0.009 to
  0.001, by asking again when the second look did not agree (0.56 times a
  run). The evaluation report's 24 development seeds disagree: there the
  Brier score was 0.017 with it and 0.011 without (see
  [Failures](#failures-negative-findings-and-uncertainty)). Each conclusion
  it commits to comes at least 1 s later.
- **Registered demonstration.** Treatment: no second look, sized by its
  pilot. Written before the pilot ran: the host's minimum effect for the
  Brier score is 0.2 (from ECHO-02's pilot) against 0.008 in development, so
  it is expected to come out inconclusive. The evaluation report's
  calibration tables are its measure. Its pilot found no seed count that
  passes with 0.9 probability, so it ran at 16 seeds and the 0.2 minimum.
  Inconclusive (above), in the expected direction on 11 of 16 seeds.

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
   hooks (every pilot of the non-ECHO protocols reproduces).
3. **Development and evaluation separated.** The self-model was built on the
   development conditions (one strength each: speed gain 0.55, turning gain
   0.6, turning bias 0.8 rad/s, a 0.9 cm/s push, a 0.6 rad/s spin, a sense ×4
   noisier), in the open 4 m room, on development seeds
   (SHA-256("echo-development/v1|" + counter)), with
   `scripts/echo-develop.ts`. Evaluation strengths come from bands that
   exclude the development values (a test checks), plus combinations, an
   obstacle and a misleading sense that development never used, in another
   arena, on other seeds.
4. **Frozen configuration.** `echo-self-model/v1` was frozen at commit
   `422f1df`, before any held-out run; after it, only the host minimum effects
   (set from the pilots' floors, the backend's rule), the demonstration sizes
   (the pilots') and a checkpoint hook in the rig changed. `v2` (the air) and
   `v3` (the indicator properties) changed the self-model after held-out
   results were published; what each was developed on, and what it had seen,
   is below. The pilots ran on held-out conditions and public pilot seeds;
   they sized, they did not tune.
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

The air (`echo-self-model/v2`) was developed on seven development cities
(seeds 4242, 777, 31337, 101, 808, 202 and 505, an hour each), never in a
registered block: the wind's rate was taken from the antennae instead of the
fly's own beliefs after that loop diverged; the wings' regime was taken from
the antennae at a period's end; and the body's lag after a change in the wind
was taken from the change in the air going by over the period, after slow
cruise into a headwind across a building's lee kept being blamed on the
sense, with the antennae's expected spread lowered from 5% to 1% so the lag
could be read from them. The default city (seed 393977), which reports the
result below, is not a development city, but it was looked at twice while
the air was built: with a first rough version, and with the version before
the lag was read from the antennae. Every change after those looks was
found and checked on the development cities, but they were made knowing how
the default city had gone, so its result is not a clean held-out test.

The indicator properties (`echo-self-model/v3`) were developed with
`scripts/echo-develop.ts` on the development conditions, arena and seeds,
including its `busy` schedule. The workspace first held a standing fly
still while it asked; that hid its steps, and a start into walking was
allowed after a retention run showed it. A takeoff during a probe slipped
past the hold until the hold was moved ahead of the probe. The second look was motivated by
ECHO-02's published held-out overconfidence. Its one parameter was set by a
principle, and nothing was run on held-out conditions before the pilots.
The busy block's urge rates were set on development conditions, after the
default rates gave the attention schema almost nothing to do. The schema's
development result was then near-null, and it was left as built.

## Failures, negative findings and uncertainty

- **Overconfidence on held-out causes (ECHO-02, ECHO-05).** On development
  data the self-model's stated confidence matches its accuracy (expected
  calibration error 0.013 in v3). On held-out data it does not: `v2` had
  0.21; `v3`, with its second look, has 0.12, and without the second look
  0.20. Conclusions stated at 0.90–0.97 are still right only 59% of the time.
  Most errors are the combined self-and-push condition answered as a push
  alone (13 of 33, against 26 of 33 in `v2`), and external changes answered
  as body and surroundings together (5 of 52). Accuracy falls from 0.98
  (development) to 0.89 (held-out).
- **The second look did not help on development data.** On the evaluation
  report's 24 development seeds, without it the fly was as accurate (0.989
  against 0.982) and its Brier score was lower (0.011 against 0.017; lower on
  20 of 24 seeds), the reverse of `scripts/echo-develop.ts`'s 16 seeds. Its
  benefit is on held-out combined causes, which it was designed after.
- **Compensation is bounded by the body (ECHO-01).** With two impairments
  together, the fly identified them to within 2% and still strayed by more
  than 0.14 of its path in 7 of 10 such seeds (up to 0.30), because the leg
  speed its compensation asks for exceeds the body's 4 cm/s. Identification
  and compensation are different things, and the report keeps them apart.
- **A cost of learning when nothing is wrong.** Before any impairment the
  self-model's path error is 0.013 against the reactive controller's 0.0005:
  its beliefs wander within their noise, and it compensates for the wander.
- **Memory helps little (ECHO-03).** Episodic memory shortens re-identification
  by a fraction of a second and does not improve the movement that follows; in
  10 of 24 held-out seeds the reset self-model's early path error was lower.
  In `v3` a reset costs 0.22 s [−0.42, 0.73], an interval that includes no
  difference, and disabling episodic memory 0.54 s [0.23, 0.95]; in `v2` it
  was the other way round (0.65 s and 0.26 s). A recalled episode's tight
  prior can also win confounded evidence, which the pooled claims and probes
  mitigate but do not remove; 0.13 recalls per run were concluded during the
  unfamiliar change, which nothing matched.
- **Uncertainty earns little in ECHO-01, much in ECHO-02.** Disabling
  uncertainty estimation changed impaired path error by only 0.002 [−0.003,
  0.007], but dropped attribution accuracy to 0.32 and made the fly blame
  itself for 83% of external changes.
- **A misleading sense is not detected.** A constant motion read that is not
  there was explained as a push in all 7 held-out onsets (never as its own
  body). With one self-motion sense, a sensor offset and an outside drift are
  observationally equivalent; the protocol scores it apart for that reason.
- **The held-out arena was a weak test of a new environment.** The walking fly
  seldom reached its walls or posts: the arena changed the outcome in 3, 7 and
  9 of 24 seeds of the three walking schedules (in all 24 for ECHO-04's busy
  fly, which flies). Generalization to unseen strengths and
  combinations is tested; generalization to unseen environments mostly is not.
- **Registered effects below their minimum.** ECHO-03, ECHO-04 and ECHO-05
  came out inconclusive by their frozen criteria, as their pilots predicted;
  their minimum effects are large because each seed draws its own condition
  and the pilots' null arms vary widely. They were not lowered. ECHO-02's
  first run was inconclusive too, and the archive keeps it.
- **The workspace's registered run went the other way (ECHO-04).** On its 16
  registered seeds the busy fly concluded 0.69 s sooner without it on average
  (3 of 5 untied seeds); on the report's 24 it concluded 1.0 s later without
  it (8 of 9). Most seeds tie: 11 of 16, and 15 of 24.
- **The air is this simulator's air.** The self-model's account of the wind
  is the body's own rule for it, exact only for its velocity tracker short of
  its acceleration limit, with no turbulence and no vertical air, and it
  takes its antennae to be nearly exact (1%), which a fly given sensory noise
  is not. Its city results ([In Bethesda](#in-bethesda)) come from cities it
  was developed on, and from a default city it was seen in. A perched fly
  sometimes concludes that its surface turned (`external:spin`), in still air
  as in wind; that predates the air.
- **The attention schema does little here.** In development it changed the
  time to conclude by 0.03 s on average and tied on 43 of 48 seeds; held out,
  0.09 s [0, 0.25], tied on 22 of 24. Its
  control acts only on what the fly may hold off, and in these arenas that is
  almost only a takeoff.
- **The second look costs time.** Each conclusion it commits to comes at
  least 1 s later, and the fly acts on the claim in the meantime.
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
the first outside cause there. `echo-self-model/v1` mostly misread it: over
the first simulated hour of the default city its fly flew for 163 s (1,076 s
in still air), cautious for 131 s of them, and concluded 80 of 106 inquiries
as its own sense misleading it, 11 as an outside push, 8 as both and 2 as its
body. Its outside drift is one velocity fixed in the world, but its body
holds its groundspeed along its heading, so only the crosswind part of the
wind moves it, and that part turns as the fly turns: no belief it could hold
explained it, and it did not feel the air.

From `echo-self-model/v2` the fly feels the air and expects it to move it as
its body lets it ([The air](#the-air)). Over the same hour it flew for 180 s,
cautious for none of them, and opened 6 inquiries: 4 concluded that its
surroundings had changed, 1 that its sense misled it, and 1 ended
unresolved; it struck a surface 9 times (14 with `v1`). Over the seven development cities, an hour each, `v1` concluded
601 inquiries as its own sense misleading it and was cautious for 2,290 of
its 3,879 s in flight; `v2` concluded 1, cautious for 61 of 2,554 s. The
default city's result is not a clean held-out test
([Scientific validation](#scientific-validation)). In still air the default
city's ECHO fly still opens one inquiry in an hour.

The panel's **Self-Model** section is read-only and shows the fly's own
estimates (what it attends to and its model of its own attention, predicted
against sensed motion, prediction error, trust in its
sense and calibration, its believed gains and capability, the open inquiry
with its leading explanations and any second look, recently revised beliefs, remembered
episodes, the active configuration and any replacement of the self-model)
apart from **ground truth only researchers see** (actual movement, the
perturbation in force). Opening it changes nothing the fly does.

The living individual on the public VM
([continuous life](BETHESDA_CONTINUOUS_LIFE.md)) is another path. It was
upgraded in place to ECHO `v2` on 2026-10-27, keeping its birth and history,
and moves to `v3` only through a second recorded continuation
([runbook](BETHESDA_CONTINUOUS_LIFE.md#continue-the-echo-v2-individual-on-echo-v3))
that keeps everything its self-model held and adds the workspace, the
attention schema and the second look empty. Nothing it did before is
credited to them.

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

The same holds for the indicator properties of `v3`. A workspace, a model of
its own attention and a second look are what some theories say a conscious
system would have. That a program has simple versions of them says nothing
about whether it experiences anything. Butlin, Long et al. 2023 take them as
evidence only under computational functionalism. Even under that view they
weigh far less here than in a system built at the scale those theories
describe. Words like "attending", "sure" and "a second look" on the panel and
`/live` name these mechanisms, nothing more.

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
- a decision well under a millisecond, and a state under 400 KB;
- the air: in cruise the crosswind carries the fly and its wings hold its
  groundspeed against the rest (a faster tailwind carries it, hovering it
  holds still, a changing wind slips what it holds); standing it feels the
  whole wind and in cruise only its own air speed; a fly that has never felt
  the air takes it to be still with no doubt; in a gusting arena wind a flying
  fly concludes nothing about its sense and believes the wind it is in, to
  0.1 m/s (`echo-self-model/v1` opened 41 inquiries there and blamed its sense
  in 34); and a self-model that cannot learn leaves the air alone.

`src/bethesda/fly/echo/indicators.test.ts`: the workspace lets in one
content, keeps it against an equal, gives it up to a clearly stronger one and
lets go below its release level; shielded, it holds off what it may but never
a hazard, touch or the air; the controller's intention read as a bid, with
hunger behind food; the attention schema learning capture rates and dwell,
expecting interruption only from what it could hold off, and predicting its
focus; in a busy fly, routine changes held and probes asked only while the
inquiry holds the workspace; shielding only with the schema; nothing held
without a workspace; a second look that commits 20 periods after the first
verdict and says so; and a second look that revises.
`src/bethesda/life/observation.test.ts` reads, refuses malformed and does
without the attention, conclusion and inquiry an ECHO life writes.

`src/rain/scientific/flyEcho.test.ts`: evaluation bands that exclude the
development values; registered blocks on evaluation conditions only, in the
held-out arena; one schedule per seed; the five demonstrations compiling,
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
doi:10.1093/biomet/41.1-2.100). The indicator properties follow Butlin, Long
et al. 2023 (doi:10.48550/arXiv.2308.08708); the workspace, global workspace
theory (Baars 1988; Dehaene & Naccache 2001, doi:10.1016/S0010-0277(00)00123-2);
the attention schema, Graziano & Webb 2015 (doi:10.3389/fpsyg.2015.00500); the
second look, metacognition as Fleming & Lau 2014 review it
(doi:10.3389/fnhum.2014.00443). None of them is evidence that a fly works the
way ECHO does.
