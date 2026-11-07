# Eva and ECHO: embodied learning without replacing the individuals

**Status: implemented as isolated research controllers, not activated on either original.**

This is the first stage of a brain upgrade, not an announcement that the living
simulation has been changed. The existing individuals' identity, genesis,
checkpoints, episodes, learned weights, RNG streams, and public ledger are
intentionally left as they are. Their machines are distinct:

- **Eva:** the authoritative `server.py` and `learning.py` live on the
  garden VM and are not in this repository. The webpage reads her `/api/state`
  but does not control her. The Python sidecar below is portable and executable,
  but cannot be integrated or deployed responsibly without those server sources
  and an approved, verified snapshot of her database.
- **ECHO:** the TypeScript life, reduced-order controller, self-model, and
  append-only checkpoint store are in this repository. The new research brain
  wraps the original ECHO adapter rather than changing its historical v3 code.
  Its separate adapter is not yet an allowed live continuation.

## What the brains actually learn

### ECHO: embodied plasticity

[`adaptiveBrain.ts`](../src/bethesda/fly/echo/adaptiveBrain.ts) adds bounded,
context-specific action-outcome memory to the existing ECHO self-model.

1. Its existing controller produces an intention and ECHO v3 evaluates it.
2. The new memory records the *executed* walking command and its energy
   context, never hidden state, world geometry, or a scenario label.
3. On the next decision, the fly's own self-motion sample and touch sense
   provide evidence of how well that commanded step worked.
4. Beta-smoothed success/failure counts estimate reliability separately for
   low and normal energy reserves. Memory is bounded to 48 detailed trials
   and aging count summaries, with no additional randomness.
5. After eight trials, an active research controller can reduce walking speed
   by 30% if its posterior failure rate exceeds one half. It cannot alter
   flight, landing, escape, motor modes, headings, or reflexes. The body's own
   command validator remains authoritative.

It can also run in **shadow mode**, observing and learning without changing a
single issued command. The module has tests for actual ECHO movement equivalence
in shadow mode, reflex interruption, memory persistence, deterministic replay,
and context separation.

To run it on a **new research fly**:

```ts
import { AdaptiveEchoBrain } from "./src/bethesda/fly/echo/adaptiveBrain";

const adapter = AdaptiveEchoBrain.factory({ seed: 41, active: false });
// Provide this as the adapter to a newly created DigitalFly research subject.
// Only after controlled evaluation: active: true.
```

The mechanism is a model of action reliability, **not** a complete brain,
synapse-accurate connectome, consciousness, or evidence that the active
controller outperforms ECHO v3.

### Eva: identity-bound contextual learning

[`eva_adaptive_brain.py`](../deploy/garden/research/eva_adaptive_brain.py)
can ingest the public `/api/state` contract, learning from each new
`learning.last` outcome **once**, keyed by its reported trial timestamp.

It rejects a different `life_id` rather than merging one fly's history into
another's. It learns success estimates for `fly`, `walk`, `rest`, and
`groom` in three interoceptive contexts: day, night, and depleted. Its bounded
records and counters can be saved as a separately named, atomic JSON sidecar,
without touching `learning.py`'s original database.

```python
from eva_adaptive_brain import EvaAdaptiveBrain

brain = EvaAdaptiveBrain()
brain.ingest_observation(state_from_get_api_state)
brain.save_sidecar("/an/operator/approved/path/experiment.eva-brain-v1.json")

# By default this cannot change any action.
same_action = brain.recommend(state_from_get_api_state, "walk",
                              ("fly", "walk", "rest", "groom"))
```

Even with explicit `active=True`, a recommendation can only change
`fly` to `walk` or vice versa when **both** have at least 12 trials in
the same context and the alternative's smoothed success estimate exceeds the
baseline by 0.2. Rest, grooming, depleted states, and unapproved motor choices
are never overridden. The original service would need to enforce its existing
motor and resource rules after any recommendation. This code **does not**
write into Eva's server, issue network requests, or run a second fly.

## Tests and integrity

- ECHO's new brain tests are in
  [`adaptiveBrain.test.ts`](../src/bethesda/fly/echo/adaptiveBrain.test.ts).
  The existing TypeScript CI suite runs them.
- Eva's isolated Python unit tests are in
  [`test_eva_adaptive_brain.py`](../deploy/garden/research/test_eva_adaptive_brain.py).
  The dedicated GitHub Actions job runs them without the VM.
- Neither controller is in the live deployment import graph; no existing
  checkpoint, brain memory, service definition, or migration script was edited.

## The non-negotiable activation gate

A branch merge **does not** upgrade either original. To do that without
rewriting their lives, the operator must first obtain the original release and
database snapshot, record the exact source digests, back up the running state,
and rehearse an isolated migration.

For **ECHO**, add a new versioned `LifeKind` and append a sealed continuation
checkpoint at the *same tick* with the same birth, exact parent digest, and an
explicit new event. A reverse projection must reproduce the old full graph
digest **byte for byte**, then the upgraded life must pass strict restore,
replay, no-fork and rollback tests. The code here is not yet such a migration.

For **Eva**, preserve the original learning database and its source version,
run the sidecar in read-only shadow mode against her reported states, and
establish a deterministic restart path before adding it as a new optional input
to `learning.py`. The existing service is authoritative; replacing or
restarting it without this evidence is not a permissible upgrade.

Before either active controller is adopted, preregister a seeded independent
evaluation with impaired motion, sensory noise, food omission, novel contexts,
restarts, and no-learning/shadow baselines. Report both benefits and regressions,
including meals, collision/touch frequency, lost histories, replay agreement,
and uncertainty. No original individual is an experimental subject.

**The history is the foundation, not the upgrade's raw material.**
