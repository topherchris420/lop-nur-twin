# Eva and ECHO: embodied plasticity for the two originals

**Status: implemented, tested and studied on research individuals. Activated on
neither original.** Activation is a separate, owner-approved procedure on each VM
([EVA_ECHO_ACTIVATION.md](EVA_ECHO_ACTIVATION.md)); a merge or a website deploy
changes neither fly.

The aim is to add learning to the two persistent flies **without replacing them**:
the same life ID, birth, genesis, checkpoint ancestry, counters, random streams
and memories, continued forward, with the addition recorded and removable by
projection at the boundary. Nothing here claims consciousness, experience,
connectome fidelity or biological life: these are bounded statistical memories in
simulated controllers.

|                         | ECHO (Bethesda headless life)                                      | Eva (garden service)                                                         |
| ----------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Where the brain runs    | `src/bethesda/life/headless.ts` on the Bethesda VM                 | `/opt/bethesda-fly/server.py` + `learning.py` on the garden VM               |
| Addition                | `echo-embodied-plasticity/v2` inside `OrganismAdapter`             | `eva-embodied-plasticity/v1`, in process, via 17 tagged lines in `server.py` |
| What it learns          | how reliably its own walking steps carry it, per energy context    | how far each motion carries her toward her destination, per sensed condition |
| What active mode may do | slow an intended walk by 30%                                       | swap fly and walk on a travel step                                           |
| Memory                  | inside the checkpointed graph (sealed, replayable)                 | a separate atomic sidecar file next to her database                          |
| Starts in               | shadow mode, by a zero-tick continuation checkpoint                | shadow mode, by `EVA_PLASTICITY=shadow`                                      |
| Mode changes            | forward-only `plasticity-policy` checkpoints                       | recorded in the sidecar's `mode_history` at each start                       |
| Turned off              | `disabled` policy checkpoint (never an older engine or checkpoint) | unset `EVA_PLASTICITY`: her original service, byte for byte                  |

## What was wrong before (PRs #176 and #177)

The merged first attempt was audited against the real systems before anything
was built on it:

- **ECHO (#177).** The plasticity changed the command _after_ ECHO v3's self-model
  had taken its efference copy, so the self-model believed one command while the
  body executed another. It credited commands that were never executed (refused by
  the body's gate, or cut short by a reflex) as outcomes. It had no shadow mode for
  the life, so a continuation would have acted from its first tick. The
  continuation did not pin the release it continued from, and there was no
  forward-only way to turn the behaviour off.
- **Eva (#176).** The sidecar compared her needs (0–100) against fractions (0.35),
  so its "depleted" context could never occur. It learned by polling `/state`, which
  shows only the latest trial: most trials were never seen, and the same trial was
  offered on every poll. Its "success" was moving 0.0003 garden units, true for
  almost every flight. It was never connected to her service.

## ECHO: `echo-embodied-plasticity/v2`

Code: [`adaptiveBrain.ts`](../src/bethesda/fly/echo/adaptiveBrain.ts),
[`plasticOrganism.ts`](../src/bethesda/life/plasticOrganism.ts),
[`plasticityContinuation.ts`](../src/bethesda/life/plasticityContinuation.ts).

1. **Where.** `PlasticityOrganismAdapter` extends the deployed `OrganismAdapter`
   and acts only at its `shape()` hook: after the controller's intention, the rest
   gate and olfaction, and _before_ fatigue scaling and ECHO v3's `act`, so the
   self-model's efference copy is the command the body receives.
2. **Evidence.** When it issues a walk, it remembers the leg speed. At the next
   decision it credits that walk only if a valid self-motion sample arrived after
   it, the body was still walking for the whole sample period, and the legs
   actually stepped at least 0.5 mm. The walk was effective when the body was
   untouched and moved forward at least 40% as far as its legs stepped. Anything
   else is discarded, never guessed: a refused command, a reflex interruption, a
   short period, a duplicate sample.
3. **Estimate.** Effective and failed counts per energy context (reserve below 35%,
   or not), capped at 1,024 with halving, and a one-sided 95% Wilson lower bound on
   the failure rate.
4. **Action.** A context is _cautious_ once it has 40 periods and the lower bound
   exceeds one half. Only then, and only in active mode, an intended walk's speed is
   multiplied by 0.7. It never touches flight, escape, landing, headings, edge
   stops, reflexes or the body's command validator.
5. **Modes.** `shadow` learns and counts the walks it would have slowed, changing
   nothing. `active` learns and acts. `disabled` neither learns nor acts and keeps
   what it learned.
6. **Life.** `PLASTICITY_LIFE` is a new versioned `LifeKind`. The continuation is
   one checkpoint at the source's tick: same birth, genesis and parent digest; an
   event recording the source release (`e458f7c…`), source state hash and graph
   digest; the plasticity added in shadow mode with no samples. Removing it
   (`plasticityProjection`) reproduces the source checkpoint's graph digest byte for
   byte. Policy changes are further zero-tick checkpoints whose leaf projection
   reproduces the previous digest. The kind refuses a second continuation, an
   active start, a moved tick, a forged event and any reversion; older engines
   refuse its checkpoints.

Shadow mode is behaviour-identical to the organism: the tests run the continued
life beside the original for 1,200 ticks and compare every held state, random
streams included, and the projected graph equals the organism's graph.

## Eva: `eva-embodied-plasticity/v1`

Code: [`deploy/garden/service/`](../deploy/garden/service/). Her live
`server.py`, `learning.py` and `backup.py` are committed byte for byte from her VM
(`original/server.py`, `learning.py`, `backup.py`; SHA-256 in `MANIFEST.json`,
checked by the tests). The patched [`server.py`](../deploy/garden/service/server.py)
adds 17 lines, each ending `# eva-plasticity`; removing exactly those lines gives
her original server byte for byte (tested).

1. **Evidence.** After every travel step `learning.execute` runs, it reads her own
   record of the trial (`learning.last`) and the step's start, target and command.
   The progress rate is the reduction in distance to the destination per second per
   unit of effort, from her noisy observed position, never the physics' true gain.
   A step counts only when it is this tick's trial of this motion with at least half
   effort. Each step is keyed by her tick, so nothing is learned twice.
2. **Estimate.** A running mean and variance per motion and her own condition
   string (`learning.context`: cold/warm, tired/rested, limited/sound, wet/dry),
   rescaled to half above 2,000 steps.
3. **Action.** In active mode, on a travel step, it swaps fly for walk or walk for
   fly only when both have 30 steps in her current condition, her exploration rule
   is not retesting (fewer than three samples of either, or every 37th trial), and
   the alternative's 95% lower bound is above the chosen motion's upper bound. Her
   physics, arrival rule, 600 s pause, boundaries and needs stay authoritative.
4. **Never.** It draws nothing from her random stream and writes nothing into her
   state or database. Its sidecar (`eva.eva-plasticity-v1.json` beside her
   database, never the database or her backups folder) is bound to her life ID and
   birth time, written atomically after her own commit, with one rolling copy per
   weekday. A sidecar for another life, or one that has learned past her current
   tick (her database restored from an older backup), is refused. Any fault
   disables the extension and she runs as her original service. With the extension
   configured, a missing database stops the service instead of beginning a new life.
5. **Observable.** `/state` gains an `adaptive` object (version, mode, status, life
   ID, ticks, samples, discarded, duplicates, swaps, would-have-swapped, estimates,
   last save, last daily copy) only when the extension is configured. The garden
   page reads it (optionally, so a malformed report is dropped rather than blanking
   the page) and adds one line to its learning panel; that page change reaches her
   site only through `deploy/garden/deploy.mjs publish`, with the owner's approval.

Shadow mode is byte-identical to her original service: the tests run the original
and patched services side by side in simulated time (normal, weak wings, steady
rain) and compare the saved world row and every moment.

## What the studies found

Research individuals only, never the originals. Plans, seeds and decision rules
were fixed in code before the held-out runs; dev seeds were looked at while the
code was written.

- ECHO: [`docs/benchmarks/echo-plasticity/`](benchmarks/echo-plasticity/) (study
  in [`src/bethesda/plasticity/`](../src/bethesda/plasticity/)).
- Eva: [`docs/benchmarks/eva-plasticity/`](benchmarks/eva-plasticity/) (study in
  [`deploy/garden/service/study.py`](../deploy/garden/service/study.py)).

Both held-out splits ran once from the clean commit `288b3a8`.

**ECHO** (24 seeds, 2 simulated hours each, 576 runs):

- **Hard checks passed.** Shadow mode was identical to the organism in 144 of 144
  paired runs (every metric and the final body and controller hash). Restored from
  a checkpoint at minute 60, every run ended exactly as the uninterrupted one, with
  what it had learned kept: 96 of 96.
- **Primary: no difference established.** With weak legs, active minus original
  meals: +0.17 (95% CI −1.00 to 1.33), better on 11 seeds, worse on 10. Energy
  taken in: −0.012 J (CI −0.056 to 0.031). The dev split's +1.13 meals did not
  replicate.
- **It acts only where the body is failing.** It slowed walks in every weak-legs
  run (failure rate about 0.72) and never in steady, moving-food, noisy-sense or
  push runs (failure rates 0.001 to 0.21). Sensor noise and an external push did not
  make it act. That is the mechanism doing what it was built to do; it is not a
  benefit.
- **Secondary, no claims.** With weak legs, active walked 1.2 m less (CI −1.7 to
  −0.8); collisions, latency and missed placements showed no difference. The
  fixed-slow ablation also showed no difference in meals with weak legs. In the
  other conditions it walked 6 to 9 m less, and its intervals for missed placements
  under push (+0.33, CI +0.08 to +0.63) and collisions with moving food (+0.17,
  CI +0.04 to +0.33) lie above zero. Active avoided those costs by not acting.

**Eva** (12 seeds, 48 simulated hours each, 288 runs):

- **Hard checks.** Shadow mode was identical to her original service in 72 of 72
  runs (world row and every moment). A stop and start at hour 24 ended exactly as
  the uninterrupted run in 45 of 48: original, shadow and active in 36 of 36. The
  three failures are the no-learning ablation's harness, which reset her gains in
  memory after her service had saved the world. A diagnostic copy that saves after
  the reset makes all three exact
  ([NOTES.md](benchmarks/eva-plasticity/NOTES.md)).
- **Primary: no difference established, with an interval of exactly zero.** Active
  mode never swapped a motion in any held-out run. In every condition its evidence
  agreed with her own `choose_motion`: even with weak wings, flying carried her
  further per second than walking, and she already chose it. Her own learning
  already makes the choice this addition was built to correct.
- **Secondary, no claims.** With her learned gains held at their prior, autumn
  gardens completed 90.8 fewer journeys (CI −118.5 to −64.6) and took 180 s longer
  over each.

**What this licenses.** Shadow mode can run on both originals without changing
their behaviour, and both can be stopped and restarted with what they learned
kept. Nothing here supports turning on active mode for either fly as an
improvement. For ECHO, active mode is a bounded, selective safety behaviour with
no measured benefit in these conditions. For Eva, it is inert in these conditions.

## Tests

- ECHO: `adaptiveBrain.test.ts` (learning, discards, shadow identity at body level,
  bounded memory) and `plasticityContinuation.test.ts` (identity, projection,
  shadow equivalence over 1,200 ticks, restart retention, refusals, incompatible
  engines, policy checkpoints, a real `LifeStore` with lease and verification).
- Observation: `/live` parses `adaptiveBrain` strictly (ECHO only).
- Eva: `deploy/garden/service/test_service.py` (source hashes, projection,
  side-by-side byte identity, restart, identity binding, faults, the real `serve()`
  process reporting `adaptive`), run by `.github/workflows/eva-brain-research.yml`.
- Rehearsal on a copy of ECHO's real backup:
  `.github/workflows/echo-plasticity-rehearsal.yml`.
