# Evaluation philosophy

Blacksite is not designed to prove that Jev is good. It is designed to make
behavioural claims about machine decision systems — Jev's, a conventional
LLM's, a script's, a person's — easier to falsify.

The question it is built around is the one a good result should provoke:

> **When an intelligent system appears to perform well, which part of that
> performance actually came from the model?**

A number from this benchmark is a measurement of one build, on one machine,
under one declared contract. It is useful exactly to the extent that someone
reading it can check what the model decided, what deterministic software did
for it, what the world did, and whether the evidence supports the sentence
written about it. Everything below exists to make those four things checkable.

This is part of the illustrative simulation at `/play`. It says nothing about
the real site at Lop Nur and writes nothing to the analytical model's evidence
ledger.

## Contents

- [Six things that are not the model](#six-things-that-are-not-the-model)
- [One seat, one pipeline](#one-seat-one-pipeline)
- [Declared before the run](#declared-before-the-run)
- [What is measured, and what is judged](#what-is-measured-and-what-is-judged)
- [Confidence is a claim, and claims can be checked](#confidence-is-a-claim-and-claims-can-be-checked)
- [Late answers fail closed](#late-answers-fail-closed)
- [Cost is unknown until someone knows it](#cost-is-unknown-until-someone-knows-it)
- [Contribution, not decomposition](#contribution-not-decomposition)
- [Same observations, other minds](#same-observations-other-minds)
- [How much evidence a run is](#how-much-evidence-a-run-is)
- [Ways this benchmark can fool us](#ways-this-benchmark-can-fool-us)
- [What it does not establish](#what-it-does-not-establish)
- [The marksman, as the standard to meet](#the-marksman-as-the-standard-to-meet)

## Six things that are not the model

A result in Blacksite is produced by six things at once. Only one of them is
the model, and every report says which of the others were in play.

| Layer                | What it is here                                                                                                                                                                                 | Where it lives                                                             |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| **Model**            | Whatever chooses the control frame: Jev, a conventional LLM, a scripted policy, a seeded random chooser, a recorded trace, a person.                                                            | `src/game/pilot/providers.ts`, `policies.ts`, `server/jev/`, `server/llm/` |
| **Controller**       | Deterministic software that executes a choice at frame rate: the executor, the precision motor controller (aim, recoil, fire gate), the places navigator. It never chooses a target or a place. | `executor.ts`, `motor.ts`, `navigator.ts`                                  |
| **Environment**      | The map, the bots and their rules, the weapons, the seat rules (`mercy` or `even`), the damage resolver. It decides every outcome.                                                              | `src/game/`, outside `pilot/`                                              |
| **Observation**      | What the seat is told, and how. The numbers (`observation.ts`), the list orders, and — for Jev and the LLM — the words the server renders them into (`server/jev/question.ts`).                 | `perception.ts`, `observation.ts`, `places.ts`, `question.ts`              |
| **Scoring function** | The rule that turns what happened into "success": an outcome contract (`cover-selection/v1`, …) or an episode metric, named before the run.                                                     | `src/game/eval/outcomeContracts.ts`, `metricRegistry.ts`                   |
| **Outcome**          | What the simulation actually did — damage applied, rounds fired, deaths, metres moved, sight lines — recorded per decision in an outcome window and per episode in the metrics.                 | `src/game/pilot/outcomes.ts`, `metrics.ts`, `debrief.ts`                   |

The failure this table guards against is attributing to the model what one of
the other five did. That happened here once already (see
[the marksman](#the-marksman-as-the-standard-to-meet)).

## One seat, one pipeline

Every brain enters through the same seam and goes through the same stages. The
decision record (`blacksite-decision/v1`, `src/game/eval/records.ts`) has one
section per stage, so each question a reader might ask has one place to look:

| Stage                   | Question it answers                             | Record section                                   |
| :---------------------- | :---------------------------------------------- | :----------------------------------------------- |
| Observation             | What did it see?                                | `observationHash`, `observation`, `context`      |
| Legal options           | What could it choose?                           | `legal`                                          |
| Model decision          | What did it choose, and who was it?             | `frame`, `source`, `brain`                       |
| Confidence              | How sure did it say it was, and in what way?    | `confidence` (with its `source`)                 |
| Accounting              | How long, how many bytes and tokens, what cost? | `accounting`                                     |
| Validation              | Was it still legal when it arrived?             | `validation`                                     |
| Deterministic execution | What did software do with it?                   | `execution`                                      |
| World outcome           | What happened next?                             | `outcome` (the window)                           |
| Evaluation              | Did it count as success, under which rule?      | computed offline from the contract; never stored |

What a brain can do is bounded by construction, not by trust: its whole output
is a control frame drawn from the options it was offered, the executor and
controllers write only the same `InputState` a keyboard does, and
`authority.test.ts` fails if any control-layer file writes health, damage,
position, colliders or weapon state. A model cannot award itself an outcome.

Where the APIs differ, the difference is stated rather than hidden. Jev answers
each control axis as a separate question, in parallel, with a probability for
every option. A conventional LLM answers every axis in one completion and, when
asked, writes a confidence number. Both are asked from the same observation, in
the same words: the LLM prompt and Jev's request are both built from
`questionParts()` in `server/jev/question.ts`, and `server/llm/handler.test.ts`
fails if their state, questions or option descriptions ever diverge. The LLM
gets longer loop limits (12 s to answer and to be stale, against Jev's 2.2 s
and 1.5 s), because without them it could never act; that is the largest stated
difference between the two seats and every report carries it.

## Declared before the run

An experiment file (`blacksite-experiment/v1`, `tools/experiments/*.json`)
states, before anything runs:

- the **question** and a **hypothesis** that could turn out false;
- the **independent variable**;
- the **primary metric**, by id — it must exist in `metricRegistry.ts`, so it
  has a definition in code — and the secondary metrics;
- the **decision type** (outcome contract) its decision metrics are scored
  under, and the **outcome window**;
- the **seeds** (or a preset: 3, 10 or 30), the **duration**, the mode and the
  seat rules;
- the **arms**, each a complete seat configuration, and which of them are the
  **control**.

The runner refuses a file that omits any of that, misspells a field, names an
unregistered metric, or asks to alter a remote model's latency. It hashes the
parsed definition into every artifact. Changing the deciding metric after
seeing a result is not forbidden — it cannot be — but it is a different hash,
and the provenance says so. Command-line overrides of the seeds or the duration
are recorded in the evaluation as overrides, with the declared values beside
them.

## What is measured, and what is judged

The browser measures; it never judges. For every executed decision it opens an
**outcome window** — five seconds by default — and accumulates what the
simulation did: damage dealt and taken, rounds fired and landed, kills, whether
the seat died, how much of the window some enemy held a sight line to it,
metres moved, how the chosen target and the chosen place fared.

Whether that was a success is decided offline, by an **outcome contract**
(`outcomeContracts.ts`): a predicate that picks a kind of decision out of a
match, and a fixed rule that classes each one's window as beneficial, neutral
or harmful. The rules are proxies and say so in words, with their thresholds'
reasons. They are versioned: a changed rule is a new id, never an edit, because
an experiment declared against `cover-selection/v1` must be scored against it.
Each contract also states what the controller _cannot_ do for the brain in
that decision, so a reader can check the experiment isolates a choice rather
than a motor skill.

There is no universal "correct". Choosing cover that turns out to be exposed
may have been the right call on what the seat knew; the contract scores what
happened, not what a better player would have done.

## Confidence is a claim, and claims can be checked

Three sources of confidence exist and they are never pooled:

- **provider-probability** — TypeSafe's own distribution over the offered
  options, and its separate confidence figure;
- **verbalized** — a number a conventional LLM wrote when asked for one;
- **none** — random, scripted and replayed brains state nothing, and nothing
  is filled in. A uniform 1/k is not substituted.

Calibration (`calibration.ts`) asks whether the stated number predicts the
declared success rate: reliability bins (below 0.50, then 0.50–0.59 … 0.90–1.00)
each with its n and a Wilson interval, the Brier score beside the score of a
predictor that only knows the base rate, and the expected calibration error.
Bins under 30 decisions are marked; an overall adequacy label says whether the
table can bear a claim.

The semantics matter. Jev's probability is over "which option should be
chosen", not over the game outcome, so a gap between Jev's stated probability
and the contract's success rate is as much a finding about the proxy as about
the model. The report names the source and the field next to every table.

## Late answers fail closed

A remote brain decides about a world that has moved on by the time the answer
arrives. The loop already discards answers that are too old or from a previous
life. At execution the host checks again (`staleness.ts`): it recomputes what is
legal _now_, by perception's own rules, and compares the choice against it — a
target that died or left view, a magazine that emptied, a jump chosen on the
ground and executed in the air, a CONTINUE for a travel that ended.

Under the default `strict` policy any illegal part refuses the whole frame, and
the seat idles until the next valid decision. A stale answer does not become
authoritative because it arrived. The `observe` policy executes it anyway and
records that it did — the behaviour before 29 September 2026, kept only to
measure what fail-closed costs. Every record carries its age at execution and
what had changed, legal or not.

## Cost is unknown until someone knows it

Prices change and are sometimes not published. The only place a price may live
is `config/pricing.json`, and every price there needs a source and a date. The
committed file prices nothing. An unknown price, or unknown token counts, make
the cost `null` — printed "n/a" — all the way up: a total over calls some of
whose cost is unknown is not printed as a total. Only local brains cost exactly
$0. `pricing.test.ts` fails if a dollar-per-token figure appears anywhere else
in the source.

## Contribution, not decomposition

The contribution analysis (`contribution.ts`) contrasts arms that differ in
exactly one factor — brain, controller, navigator, motor profile — on the same
seeds, and prints the other factors' levels beside each contrast. Where a full
2×2 exists it prints the interaction: how much one factor's effect changes with
the other's level.

It deliberately does not print "the model contributed 62%". Effects here
interact — the aiming controller is worth far more to a brain that engages
than to one that hides — so shares of a total do not add up, and a
decomposition would be a number the design cannot support.

## Same observations, other minds

A matched seed pairs the start of a match and nothing after it: frame pacing is
not deterministic, and after the first decision no two seats ever see the same
thing again. So outcome comparisons are always between different situations.

The decision records allow a sharper comparison. Each holds the exact
observation a choice was made from, and the scripted reference policies are
pure functions of an observation and two counters. `src/game/eval/shadow.ts`
shows an arm's observations, in order, to the marksman and the skirmisher, and
counts on how many decisions, axis by axis, the arm chose what the reference
would have chosen. `node tools/experiment.mjs --shadow <run dir>` writes
`shadow.json` and `shadow.md` from a run's archived records without playing a
match or calling a model, and `/evaluation` shows them; opening a single
episode's records there computes the same table for that episode.

Four rules keep it honest:

- **Chance is exact, not simulated.** On an axis offering _k_ options, a uniform
  chooser agrees with any fixed choice with probability 1/_k_; every cell prints
  that baseline beside the agreement. An axis offering one option is not a
  choice and is left out of both.
- **The random arm is the control and the reference arm is the ceiling.** Random
  must sit at chance on every axis; a policy shown its own observations shows
  how close to 100% the instrument can get, and why not exactly.
- **The episode is the unit.** Decisions within an episode are correlated, so
  rates are averaged per episode and never pooled into a falsely precise figure.
- **It is agreement, not a counterfactual and not a score.** The reference acted
  on nothing — had it held the seat, its own choices would have changed every
  later observation — and agreeing with a hand-written rule is good only where
  the rule is. Agreement does not say why two choosers agree.

The first use is in the
[5 October record](benchmarks/2026-10-05/README.md#same-observations-other-minds).

## How much evidence a run is

- **Episodes are the unit.** Every interval is taken over episodes, never over
  frames or decisions.
- **Seeds pair, trajectories do not.** The same seed starts the same match, but
  frame pacing is not deterministic and the worlds diverge within seconds.
  Paired differences are by seed; the report says what that does not mean.
- **Decisions are not independent.** A brain deciding five times a second with
  a five-second window has about twenty-five windows open at once. Pooled
  decision counts are printed, and so is the warning that they overstate the
  evidence.
- **Three seeds is exploratory.** The `quick` preset is for development; `dev`
  (10) and `eval` (30) exist for claims. Every evaluation under ten seeds
  carries an `insufficient-seeds` note. No evaluation claims significance.
- **Same-seed runs differ.** Two runs of the same configuration on the same
  seeds (the skirmisher, 27 September) gave 93 and 80 kills. Differences
  smaller than that are noise.

## Ways this benchmark can fool us

Each of these has happened here, or could. The right-hand column is what makes
it visible.

| How                                    | What it looks like                                                                                                                   | What exposes it                                                                                                                                                           |
| :------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Environment exploit**                | A strategy wins because the world is broken, not because it is good: a still shooter at 100 m the bots could not answer.             | Scripted policies on the same seeds; `stationary-dominance`, `impossible-survival` and `low-opponent-hit-rate` warnings; `seat: even`.                                    |
| **Controller dominance**               | The aiming controller or the navigator does the work; any brain behind them looks competent.                                         | Random through the same controllers; `controller-dominance` and `model-irrelevance` warnings; `controller-ablation` (degraded, direct).                                   |
| **Prompt leakage**                     | The rendered question does the reasoning: "turn right, medium (9.4 degrees)" is arithmetic done for the model; a phrasing can steer. | The question is server code, hashed into every record (`questionHash`); descriptions say what a control does, never when to use it.                                       |
| **Option-order bias**                  | A brain picks the first option shown, and the first option happens to be good (Jev chose PLACE_0 in 208 of 208 choices).             | `placeOrder=shuffled`, `targetOrder=shuffled`; `option-position-bias` warning; `first_slot_share` against the position-blind rate.                                        |
| **Insufficient seeds**                 | Three episodes where one lucky seed carries the mean.                                                                                | Every episode is printed; intervals are wide on purpose; presets for 10 and 30.                                                                                           |
| **Overfitting to one map**             | A result that holds on this open, long-sight-line airfield and nowhere else.                                                         | Nothing yet: there is one map. Stated as a limitation, not solved.                                                                                                        |
| **Provider nondeterminism**            | The same observation gets different answers on different days; a pinned alias resolves to a new model.                               | The served model is recorded per decision (`accounting.model`), not the requested alias, and is null when the provider names none; the question hash pins what was asked. |
| **Scoring-proxy mismatch**             | The contract rewards something that is not what the experiment is about: "no damage for five seconds" rewards never engaging.        | Contracts state their rule in words; secondary metrics sit beside the primary; harmful and neutral rates are printed with success.                                        |
| **Observation advantage**              | A brain is told what a person is not: exact bearings, the places list, "hidden from known threats".                                  | [One set of senses](JEV_BLACKSITE.md#one-set-of-senses): what the HUD shows and what the observation holds follow one rule; asymmetries are listed.                       |
| **Human / model sensory mismatch**     | A person hears footsteps and reads pixels; a brain gets numbers. Neither comparison is like-for-like.                                | Stated per comparison; human seats are labelled with their profile (`standard`, `elite`).                                                                                 |
| **Interface asymmetry between models** | One model gets an easier interface (longer limits, a different question).                                                            | Negotiated limits are recorded with every result; the parity test pins the question text; differences are listed in the experiment notes.                                 |
| **Silent substitution**                | A fallback or a different model answers some of an arm's decisions.                                                                  | Fallback frames are labelled `fallback-random`; the LLM adapter enables no provider-side model fallback; the served model is per decision.                                |
| **A test double read as a model**      | Pipeline checks against the offline fake read as LLM results.                                                                        | The fake's model id is `fake-llm-test-double`; arms using it are labelled TEST DOUBLE in every table; the benchmark refuses to mislabel.                                  |
| **Headless pacing**                    | The simulation runs slower than real time, so a brain gets more decisions per simulated second.                                      | Every episode records wall time per simulated second; lagged episodes are flagged in the report and the warnings.                                                         |

## What it does not establish

- **That a model is good at games, or at anything else.** A result is a
  measurement of one build on one map against these bots under these rules.
- **That one model is better than another in general.** It can show that, on
  this task, with this interface, one arm's declared metric was higher, with
  an interval — and that is all.
- **Causal decomposition of a result into model and controller shares.** It
  shows contrasts and interactions; it does not apportion.
- **That a stated probability is calibrated in general.** Calibration is
  against one declared proxy outcome, in one kind of decision.
- **That scripted policies are strong players.** They are measuring
  instruments: legible plans written down so a model's behaviour can be
  compared against a plan with no model in it.
- **Anything about the real site.** Blacksite is an illustrative simulation.

## The marksman, as the standard to meet

On 26 September 2026 the live model went 148 kills to 0 deaths under precision
control, standing still at about 100 m. It was an impressive number. The
question it raised — model, controller or map? — was answered by writing the
strategy down as a script (`marksman`) and running it on the same seeds: the
script did 153 to 0. The finding was about the game. The environment was
repaired (heat shimmer at range, bots that bound between hidden points, spawns
out of sight, an even seat), the experiment was rerun, and the farming rate
halved — halved, not solved, and reported as such.

That sequence is the standard every result here should be held to: an
impressive number, a baseline that could explain it, a repair where the
baseline found a flaw, and a rerun whose result is reported whatever it is.
The harness exists so that the next one is found faster.
