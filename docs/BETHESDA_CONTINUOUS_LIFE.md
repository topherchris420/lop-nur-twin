# Continuously living Bethesda — implementation record

## Desired outcome

A single authoritative digital fly and a single Bethesda city simulation
advance while no visitor is present. Every visitor inspects the **same state**.
A process restart, deployment, or browser refresh must not reset the fly's
position, physiological reserve, navigation memory, or lived history.

This is a research-simulation continuity requirement, **not consciousness**.
The fly remains a reduced-order behavioural controller, not a neural simulation.

## Status: durable on one machine, not deployed

`src/bethesda/life/headless.ts` supplies a headless deterministic runner of
the existing `CitySimulation` and `CityFly`. It needs no browser and creates
only one fly per process. `scripts/bethesda-life-headless.ts --ticks 100`
exercises a finite run; `--continuous` is development-only.

With `--store DIR` the life is one individual kept in a directory
([individual continuity](INDIVIDUAL_CONTINUITY.md)): `--create` gives it a
birth (a host-drawn nonce, so a second store from the same genesis is a
second individual), and every later run takes the single-writer lease,
restores the newest checkpoint, verifies it, lives on, and commits a sealed
checkpoint every five simulated minutes, each restored and re-checked before
it is committed. `--verify` checks the whole chain. A process killed between
checkpoints loses only the uncommitted ticks, which are not claimed; once its lease lapses (60 s) the next
run resumes from the last committed checkpoint.

**Do not configure an always-on cloud worker yet.** The store is a local
directory, not a transactional database, and there is no observer API.
Browser visits still run their existing local city and fly. There is no
visitor-facing shared fly yet.

| Criterion                      | Status                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Durable clock and snapshots | **Met on a filesystem.** `snapshot.ts` records the whole object graph of city and fly (every random stream's position, pending sensory frames, controller and navigation state, people), versioned by city, fly, ECHO and headless schema; sealed by SHA-256; written atomically. Older or newer versions are refused.                 |
| 2. Crash recovery              | **Met in tests.** Restores are re-snapshotted and compared byte for byte, then stepped beside the uninterrupted life and compared at several intervals: the city with both controllers, and the fly in flight, landing, grooming and feeding. Corruption stops with the reason. A swat in progress has not been captured specifically. |
| 3. One writer                  | **Met on one machine.** An expiring lease, one file per epoch created exclusively; a replaced writer is fenced; a second continuation of a checkpoint is refused as a fork, never merged. Not a database lock; blue-green deployment untested.                                                                                         |
| 4. Wall-clock policy           | **Met: paused during outage.** A resumed life records a `gap` event (stopped, resumed, UTC) and computes no catch-up ticks.                                                                                                                                                                                                            |
| 5. Bounded histories           | **Partly.** The city's replay windows are already bounded (`REPLAY_LIMITS`), so a checkpoint is bounded (about 8–17 MB, most of it the decision window and the fly's static city geometry); only the newest four keep their graphs. The chain of headers and life events grows by about a kilobyte per checkpoint and is not rotated.  |
| 6. Read-only observer API      | Not started.                                                                                                                                                                                                                                                                                                                           |
| 7. Visitor integration         | Not started.                                                                                                                                                                                                                                                                                                                           |
| 8. Operations                  | Not started; nothing is provisioned.                                                                                                                                                                                                                                                                                                   |

## Production design and acceptance criteria

1. **Durable clock and snapshots.** Version the city, fly, controller, senses,
   people, PRNG streams and world fingerprint. Snapshot every mutable input
   that can affect future transitions, including the pending fractional clock,
   sensory history and controller navigation state. Store with a transaction
   and canonical hash. Reject mismatched simulator versions; never silently
   reinterpret an older checkpoint.
2. **Crash recovery.** Restore a checkpoint into an equivalent simulation.
   Verify its pre-save hashes, advance both the uninterrupted and restored
   worlds on the same steps, and assert byte-identical state hashes at multiple
   intervals. Capture mid-flight, mid-landing, mid-grooming, and mid-swat.
   Corruption must stop advancement and raise a visible error, never start
   a new insect with the same ID.
3. **One writer.** A durable, expiring leadership lease (or database advisory
   lock) ensures that exactly one worker can commit a tick at a time. Fence
   old leaders by monotonically increasing epoch. On worker death, the next
   instance must resume from the last committed checkpoint. Never merge two
   separately evolved histories.
4. **Wall-clock policy.** Use UTC timestamps for audit only and a monotonic
   local clock to schedule 0.1-second simulation ticks. Account for downtime
   openly: either catch up with verified replay under a declared cap or mark
   the world paused during outage. Never claim that uncomputed ticks occurred.
5. **Bounded histories.** City recordings and fly logs must not grow without
   limit. Separate immutable, append-only life events from the city's bounded
   research replay windows, keeping scientific experiment archives unchanged.
   Rotate long-running operational journals with explicit retention rules.
6. **Read-only observer API.** Publish a validated, rate-limited snapshot
   carrying generation/epoch, city and fly versions, tick, UTC checkpoint time,
   position, mode, energy, counters and stale status. Browser viewers
   interpolate only for presentation. They never tick or mutate the canonical
   world, and must show unavailable/stale instead of creating a fallback fly
   disguised as shared.
7. **Visitor integration.** Bethesda loads a shared fly view and nearby
   authoritative pedestrian state. Existing local city/replay and independent
   lab fly experiments remain available as explicitly labelled modes; neither
   writes to the shared world. Do not conflate live-world observations with
   preregistered biological evidence.
8. **Operations.** Deploy one always-on cloud worker, a durable transactional
   database, a read-only API, backup/restore and health checks. Set spend
   limits before enabling the worker. Test blue-green deployment and forced
   termination with no duplicate writer or lost committed state.

The live fly is not complete until all eight criteria are tested. The
production footprint is intentionally not provisioned by this foundational
change.

## Why the simulation could not simply be moved to a server

`CityFly` tracks the browser's `CitySimulation`; it is created at that
city's current tick and has no restore method of its own. The fly's
`stateHash` deliberately does **not** preserve random-stream positions or
all pending sensory frames. The city and fly have internal seeded random
generators and mutable controller state. Persisting only position, energy and
a timestamp would produce a different fly after restart. That is why the
checkpoint is the whole graph, restored in place into a life rebuilt from its
genesis, with the streams' positions read through `src/lib/noise.ts`.

Current Vercel Functions scale to zero with no requests. Vercel Daemons,
introduced in public beta in October 2026, can host long-running workers,
but Daemons do not yet include persistent filesystem storage. A database
and explicit recovery protocol are mandatory.

## Project ECHO's experimental checkpoint

With `--controller echo` the headless fly runs [Project ECHO](PROJECT_ECHO.md)'s
self-model, and `HeadlessBethesdaLife.selfModelCheckpoint()` returns an
`echo-checkpoint/v1`: the self-model's whole state, sealed, refused on any
version, variant or byte mismatch. It is labelled experimental and is **not**
the durable recovery criterion 2 asks for: it holds no city, body, controller
state or random stream, so restored into another process it would give a
different fly this one's self-model. The life checkpoint (`continuity.ts`)
holds the self-model too, as part of the whole graph, and is what a durable
store keeps.

## Verification

```sh
npm run bethesda:life:smoke
node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --ticks 100 --controller echo
node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --store /tmp/fly --create
node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --store /tmp/fly --ticks 6000
node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --store /tmp/fly --verify
npx vitest run src/bethesda/life
```
