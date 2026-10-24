# Continuously living Bethesda — implementation record

## Desired outcome

A single authoritative digital fly and a single Bethesda city simulation
advance while no visitor is present. Every visitor inspects the **same state**.
A process restart, deployment, or browser refresh must not reset the fly's
position, physiological reserve, navigation memory, or lived history.

This is a research-simulation continuity requirement, **not consciousness**.
The fly remains a reduced-order behavioural controller, not a neural simulation.

## Status: foundation only, not persistent or deployed

`src/bethesda/life/headless.ts` supplies a headless deterministic runner of
the existing `CitySimulation` and `CityFly`. It needs no browser and creates
only one fly per process. `scripts/bethesda-life-headless.ts --ticks 100`
exercises a finite run; `--continuous` is development-only. Its clock will
stop when the process stops. Its memories are currently **in memory only**.

**Do not configure an always-on cloud worker yet.** This phase has neither
durable checkpoint restore nor a lease, and restarting or accidentally running
two instances would produce separate flies. Browser visits still run their
existing local city and fly. There is no visitor-facing shared fly yet.

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

## Why the existing simulation cannot simply be moved to a server

`CityFly` currently tracks the browser's `CitySimulation`; it is created
at that city's current tick and has no public restore method. The fly's
`stateHash` deliberately does **not** preserve random-stream positions or
all pending sensory frames. The city and fly have internal seeded random
generators and mutable controller state. Persisting only position, energy and
a timestamp would produce a different fly after restart.

Current Vercel Functions scale to zero with no requests. Vercel Daemons,
introduced in public beta in October 2026, can host long-running workers,
but Daemons do not yet include persistent filesystem storage. A database
and explicit recovery protocol are mandatory.

## Verification of foundation

```sh
npm run bethesda:life:smoke
npx vitest run src/bethesda/life/headless.test.ts
```
