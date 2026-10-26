# Continuously living Bethesda — implementation record

## Desired outcome

A single authoritative digital fly and a single Bethesda city simulation
advance while no visitor is present. Every visitor inspects the **same state**.
A process restart, deployment, or browser refresh must not reset the fly's
position, physiological reserve, navigation memory, or lived history.

This is a research-simulation continuity requirement, **not consciousness**.
The fly remains a reduced-order behavioural controller, not a neural simulation.

## Status: durable on one machine, living on one VM

`src/bethesda/life/headless.ts` supplies a headless deterministic runner of
the existing `CitySimulation` and `CityFly`. It needs no browser and creates
only one fly per process. `scripts/bethesda-life-headless.ts --ticks 100`
exercises a finite run; without `--store`, `--continuous` is development-only.

With `--store DIR` the life is one individual kept in a directory
([individual continuity](INDIVIDUAL_CONTINUITY.md)): `--create` gives it a
birth (a host-drawn nonce, so a second store from the same genesis is a
second individual), and every later run takes the single-writer lease,
restores the newest checkpoint, verifies it, lives on, and commits a sealed
checkpoint every five simulated minutes, each restored and re-checked before
it is committed. `--verify` checks the whole chain; `--check` also restores
the head in memory, as a resume would, without the lease and without writing.
A process killed between checkpoints loses only the uncommitted ticks, which
are not claimed; once its lease lapses (60 s) the next run resumes from the
last committed checkpoint.

`deploy/bethesda-life/` runs it as one always-on worker on one Ubuntu
machine ([below](#running-it-on-one-vm)): a systemd service that resumes the
same individual after a crash or a reboot, its store on the boot volume and
its status lines in the journal. One individual has lived that way on an
Oracle Cloud VM since 2026-10-26 (criterion 8). That is one machine, not the
production service: the store is a local directory, not a transactional
database. A read-only observer serves what anyone may see of the life
(criterion 6, [below](#witnessing-it)), but browser visits still run their
own local city and fly.

| Criterion                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Durable clock and snapshots | **Met on a filesystem.** `snapshot.ts` records the whole object graph of city and fly (every random stream's position, pending sensory frames, controller and navigation state, people), versioned by city, fly, ECHO and headless schema; sealed by SHA-256; written atomically. Older or newer versions are refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2. Crash recovery              | **Met in tests.** Restores are re-snapshotted and compared byte for byte, then stepped beside the uninterrupted life and compared at several intervals: the city with both controllers, and the fly in flight, landing, grooming and feeding. Corruption stops with the reason. A swat in progress has not been captured specifically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3. One writer                  | **Met on one machine.** An expiring lease, one file per epoch created exclusively; a replaced writer is fenced; a second continuation of a checkpoint is refused as a fork, never merged. Not a database lock; blue-green deployment untested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4. Wall-clock policy           | **Met: paused during outage.** A resumed life records a `gap` event (stopped, resumed, UTC) and computes no catch-up ticks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5. Bounded histories           | **Partly.** A checkpoint is bounded only by the city's replay limits (`REPLAY_LIMITS`), which are counts, not a sliding window: it grows from 8 MB at birth to 84 MB when the decision record reaches 60,000 decisions, after about 41 simulated hours, and then stops (measured; [below](#what-the-machine-needs)). Most of it is that record and the fly's static city geometry. Only the newest four keep their graphs. The chain of headers and life events grows by about a kilobyte per checkpoint (about 300 KB a day) and is not rotated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 6. Read-only observer API      | **Met on one machine.** About once a second the life writes an observation (`observation.ts`): individual, epoch, city, fly, ECHO and headless versions, tick, the head checkpoint and its UTC commit time, the fly's position, velocity, heading, mode, energy and counters, its recent decisions with reasons, the people outdoors near it, and ECHO's self-model summary. It is made by reading the life only and never enters a checkpoint; a life observed every tick hashes the same as one never observed. A separate service serves it read-only as a witness that says `live`, `stale` (with the last observation) or `unavailable`, never an observation it could not validate; requests are rate-limited and streams capped per address. Not a database read; one observer, on the life's own machine; not load-tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7. Visitor integration         | Not started.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 8. Operations                  | **Partly: one worker living on one VM.** `deploy/bethesda-life/` installs a hardened systemd service (restarted after a crash once the lease lapses, started at boot, checkpointed on stop, logged to the journal), a checksum-pinned Node, upgrades and rollbacks that switch only after the new release restores the head, and backups kept only if they restore. Since 2026-10-26 one individual lives on an Oracle Cloud `VM.Standard.A1.Flex` (1 OCPU, 8 GB, Ubuntu 24.04.5, arm64): `install.sh --create`'s trial life passed in 30 s at 1,335 MB peak resident memory, and the service committed its first verified checkpoint (12.4 MB) five minutes after the birth, with systemd's memory peak at 1.02 GB and no restart. `backup.sh` ran beside it 18 minutes after the birth ([below](#backup)). A reboot 26 minutes after the birth paused it openly: on the shutdown the service committed a last checkpoint (22.7 MB) in 9 s and stopped cleanly; it started 12 s after the kernel came up, resumed the same individual with no restart and recorded a 53 s gap. Not yet run on the VM: an upgrade, a rollback and forced termination. Not done: a transactional database, alerting (the observer's `/v1/health` reports, but nothing watches it), spend limits, automatic off-machine backups, and blue-green deployment (an upgrade pauses the life). |

## Running it on one VM

`deploy/bethesda-life/` runs the durable life as one always-on systemd
service on one Ubuntu 24.04 machine, x86_64 or Arm:

- **`install.sh`** installs a pinned Node (24.22.1, checked against its
  SHA-256), copies the runner and `src/` from the checkout's HEAD commit
  into `/opt/bethesda-life/releases/<commit>` with the locked production
  dependencies, installs the unit and starts it. `--create` first runs a
  throwaway trial life on the machine and then gives the individual its
  birth. Without it the script upgrades: it stops the service, which commits
  a last checkpoint, checks that the new release can resume the individual,
  and only then switches to it; if not, it starts the old release again and
  changes nothing. `--rollback` goes back one release, after the same check.
- **`bethesda-life.service`** runs
  `bethesda-life-headless.ts --store /var/lib/bethesda-life/store --continuous`
  as the unprivileged user `bethesda-life`, with the store on the boot volume
  and its status lines (one a minute) and errors in the journal. It starts
  at boot. Whenever the process stops it is started again 75 s later, once a
  dead writer's 60 s lease has lapsed, and it never gives up. On
  `systemctl stop` or a shutdown it commits a last checkpoint and releases
  the lease. It has no network, holds no capability and can write only its
  store and `/run/bethesda-life/`, where it writes an observation about once
  a second.
- **`bethesda-life-observer.service`** serves that observation, read-only,
  on 127.0.0.1:8790 ([below](#witnessing-it)), as a throwaway user that
  cannot see the store. **`public.sh`** puts it on the internet over HTTPS.
- **`backup.sh`** archives the store while the life runs and keeps the
  archive only if an unpacked copy passes `--check`.

Every stop is an outage: the next start records a `gap` and computes no
catch-up ticks, so an upgrade, a backup restore or a reboot pauses the life
openly.

### What the machine needs

Measured on the development laptop (Node 24.19, arm64) with the headless
default city (`PROFILES[1]`) and the reduced-order fly. On a VM only a young
life has been measured so far (criterion 8).

**The checkpoint grows for about two simulated days.** The city's replay
limits (`REPLAY_LIMITS`) are counts, not a sliding window: its decision
record grows from birth until it holds 60,000 decisions and then stops
recording. So does the checkpoint:

| The life's age | Tick      | Checkpoint |
| -------------- | --------- | ---------- |
| birth          | 0         | 8.2 MB     |
| 10 minutes     | 6,000     | 15.8 MB    |
| 100 minutes    | 60,000    | 33.8 MB    |
| 5 hours        | 180,000   | 42.3 MB    |
| 40.7 hours     | 1,464,000 | 83.8 MB    |
| beyond         |           | 83.8 MB    |

**Memory is several times the checkpoint.** A resume parses the chain and
restores the head into a life rebuilt from its genesis; every new checkpoint
is snapshotted, serialized, hashed, restored into another life and compared
byte for byte while the living one waits. The smallest V8 heap that survives
a resume and one verified checkpoint:

| Checkpoint             | Fails at      | Works at | Peak resident memory |
| ---------------------- | ------------- | -------- | -------------------- |
| 25 MB (35 minutes old) | 512 MB heap   | 768 MB   | 0.94 GB              |
| 84 MB (full-grown)     | 1,792 MB heap | 2,048 MB | 2.35 GB              |

The service sets a 2,560 MB heap. Living full-grown under it with
`--continuous`, a checkpoint committed in real time and the process peaked
at 3.2 GB resident. `--check` alone needs less (it passes with a 1,536 MB
heap at 1.9 GB resident), but `backup.sh` runs one beside the living life.
With Ubuntu's own share, `install.sh` refuses a machine with less than
7,000 MB of memory: an 8 GB machine.

**So the 1 GB `VM.Standard.E2.1.Micro` cannot hold it**: a 35-minute-old
life already peaks at nearly its whole memory, before Ubuntu's share, and a
full-grown one needs more than three times that. Swap is no substitute: the
garbage collector walks the live heap. On Oracle's Always Free tier the fit
is `VM.Standard.A1.Flex` (Arm), whose allowance is 2 OCPUs and 12 GB in all:
1 OCPU and 8 GB.

**CPU is light but bursty.** A tick costs about 0.7 ms (under 1% of a core
at ten a second). A full-grown checkpoint blocks the clock for 17.5–18.6 s
(3.3–3.7 s to make it, 10.3–10.6 s to restore and compare it, 3.9–4.6 s to
write it and drop an old graph), every five minutes: about 6% of a core on
average. A resume takes 14–25 s: 11 s to restore the head, and 3 s to check
the chain with one full graph in it, more with the four a running store
keeps. A cloud core can be two or three times slower than the laptop's,
so the runner tolerates falling up to 1,800 ticks (three minutes) behind
wall time and computes the missed ticks afterwards, and it renews its lease
just before committing. A checkpoint that takes longer than the 60 s lease
to make and verify would still fail the commit; on a 1/8-OCPU Micro it
would.

### Setup

1. Make the VM: Ubuntu 24.04 with 8 GB of memory (on Oracle's Always Free
   tier, `VM.Standard.A1.Flex` with 1 OCPU and 8 GB; not the 1 GB
   `VM.Standard.E2.1.Micro`, above). It needs outbound HTTPS once, for Node
   and npm; the life itself needs no network, and only the observer listens,
   on loopback, until `public.sh`.
2. On the VM:

   ```sh
   sudo apt-get update && sudo apt-get install -y git
   git clone https://github.com/topherchris420/lop-nur-twin.git
   cd lop-nur-twin
   sudo deploy/bethesda-life/install.sh --create
   ```

   It checks the memory, installs Node, builds the release, runs the trial
   life (born, 3000 ticks, one verified checkpoint, deleted), gives the
   individual its birth, starts the service and watches it for 90 s. Add
   `--controller echo` for Project ECHO's controller.

3. Watch it: `journalctl -u bethesda-life -f` (a status line a minute: tick,
   hashes, the fly's position, mode, energy, meals) and
   `systemctl status bethesda-life`. To check the whole chain at any time:

   ```sh
   cd /opt/bethesda-life/current && sudo runuser -u bethesda-life -- \
     /opt/bethesda-life/node/bin/node scripts/run-ts.mjs \
     scripts/bethesda-life-headless.ts --store /var/lib/bethesda-life/store --verify
   ```

### Witnessing it

About once a second the life writes what an observer may see to
`/run/bethesda-life/observation.json` (schema `bethesda-life-observation/v1`,
`observation.ts`): its individual, epoch and versions, the tick and simulated
time, the head checkpoint, the fly's position, velocity, heading, mode,
energy, meals and escapes, its last six decisions with their reasons, the
people and vehicles outdoors within 40 m of it, and with ECHO's controller a
summary of its self-model. It is made by reading the life only and written
beside it, never into a checkpoint: a life observed every tick lives exactly
as one never observed (the tests compare their hashes). systemd removes the
file whenever the life stops.

`bethesda-life-observer.service` serves it on 127.0.0.1:8790. It reads that
file and nothing else; it cannot tick, step, restore or write the life.

| Request          | Answer                                            |
| ---------------- | ------------------------------------------------- |
| `GET /v1/now`    | the witness (`bethesda-life-witness/v1`), JSON    |
| `GET /v1/stream` | the witness once a second, as server-sent events  |
| `GET /v1/health` | 200 `live`, or 503 with the status and the reason |

The witness is `live` while the observation is under 5 s old (180 s while
the life makes a checkpoint, which stops its clock), then `stale`, still
carrying the last observation, and `unavailable` when there is none (the
life is stopped) or it fails validation; an invalid observation is never
served. Each address may make 2 requests a second after a burst of 10, and
hold 4 streams; 2,000 streams in all.

To put it on the internet over HTTPS:

```sh
sudo deploy/bethesda-life/public.sh A-B-C-D.sslip.io   # the VM's public address, dashed
```

It installs Caddy, which obtains and renews a Let's Encrypt certificate for
the name, and opens TCP 80 and 443 in the VM's own firewall. A cloud firewall
in front of the VM must allow them too: on Oracle, two stateful ingress rules
in the subnet's security list, TCP 80 and TCP 443 from `0.0.0.0/0`.

### Upgrade

```sh
cd ~/lop-nur-twin && git pull --ff-only
sudo deploy/bethesda-life/install.sh
```

It builds the new release beside the running one, stops the service, and
runs `--check` with the new release. If the new release can resume the
individual it switches to it and starts it; if it cannot, it starts the old
release again and exits with the reason. `sudo deploy/bethesda-life/install.sh --rollback`
returns to the previous release, after the same check. The two newest
releases are kept.

A checkpoint is refused by any other city, fly, ECHO, headless or graph
version, so **a release that bumps any of those cannot continue this
individual**, and `install.sh` says so (for example
`checkpoint 0 is corrupt: made by fly digital-fly/7; this is digital-fly/8`).
Either stay on the release that is running, or end this individual's life
on this machine: stop the service, move the store aside and keep it (it is
the individual's whole record), and run `install.sh --create` for a new
individual on the new release. Never edit a checkpoint's versions to make it
load.

### Backup

```sh
sudo deploy/bethesda-life/backup.sh            # → /var/backups/bethesda-life/bethesda-life-<UTC>-<commit>.tar.gz
ssh ubuntu@VM sudo cat /var/backups/bethesda-life/NAME.tar.gz > NAME.tar.gz   # from your own computer
```

The archive is taken while the life runs (every file in the store is
published whole, so the copy holds the chain up to some checkpoint) and is
kept only if an unpacked copy passes `--check` with the installed release.
Its name carries the commit of the release that wrote it. `backup.sh` keeps
every archive it makes; delete old ones yourself. Keep copies off the VM: an
Always Free VM can be reclaimed (below), and a boot-volume backup in the
console (five are free) is a second, whole-disk layer, not a substitute.

On the VM it has run once, on 2026-10-26, beside an 18-minute-old life with
four checkpoints: it took 12 s, its check peaked at 946 MB resident, and the
archive (7.5 MB) streamed off the machine matched its SHA-256. The life kept
its clock throughout (600 ticks a minute, the same process, no restart) and
committed its next checkpoint on time. No copy has failed its check there,
so the refusal path is untested on a VM.

A backup is this individual, not a copy of it. Restore one only in place of a
store that is lost or broken, and never run it beside a store that still
lives, on this machine or any other: two continuations of one individual
are a fork that no lease can see.

### Recovery

| In `journalctl -u bethesda-life`                                          | What it means                                                          | What to do                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `the lease is held by pid N (epoch E) until T`                            | A writer died without releasing its lease, less than 60 s ago.         | Nothing. The next restart, 75 s later, takes the lease.                                                                                                                    |
| `Headless city fell N ticks behind wall time`                             | The life fell three minutes behind wall time: the machine is too slow. | It restarts itself, with a gap. If it repeats, the machine is too slow: move the life to a faster one (restore a backup there).                                            |
| `the lease of epoch N expired at T`                                       | Making and verifying a checkpoint took longer than the 60 s lease.     | It restarts itself, with a gap. If it repeats, the machine is too slow, as above.                                                                                          |
| `JavaScript heap out of memory`, or an `oom-kill` in `journalctl -k`      | The life outgrew its heap or the machine's memory.                     | If the machine has room, raise the heap in a drop-in (`sudo systemctl edit bethesda-life`: `Environment=NODE_OPTIONS=--max-old-space-size=…`); otherwise a larger machine. |
| `checkpoint N is corrupt: …`, `does not continue …`, `restore refused: …` | The store failed its checks. Nothing starts in its place.              | Do not delete or edit it. Restore the newest backup that passes, as below.                                                                                                 |
| `ENOENT … individual.json`, `holds no checkpoint`                         | The store is missing or empty.                                         | Restore a backup, as below, or birth a new individual with `install.sh --create`.                                                                                          |

To restore a backup in place of a broken or lost store:

```sh
sudo systemctl stop bethesda-life
sudo mv /var/lib/bethesda-life/store /var/lib/bethesda-life/store.broken-$(date -u +%Y%m%dT%H%M%SZ)   # keep it
sudo tar -xzf bethesda-life-<UTC>-<commit>.tar.gz -C /var/lib/bethesda-life
sudo chown -R bethesda-life:bethesda-life /var/lib/bethesda-life/store
sudo deploy/bethesda-life/install.sh            # checks it resumes, then starts it
```

On a new machine, clone the repository, `git checkout` the commit in the
archive's name (or any later one with the same versions), restore the store
the same way, and run `install.sh` without `--create`. The life resumes from
the backup's newest checkpoint with a `gap` from that checkpoint's commit
time; whatever the lost store committed after the backup is lost with it and
is not claimed.

### Known limits

- **Upgrades pause the life**, and a version bump ends it on this machine
  (above). Blue-green deployment is untested.
- **Starting and committing take longer as the life ages.** Opening the
  store reads every checkpoint from birth, and each commit re-reads every
  older header to drop graphs: 288 more files for every simulated day. Not
  yet measured on a long chain.
- **Oracle may reclaim an Always Free VM it deems idle**: 95th-percentile
  CPU and network use under 20% for 7 days, and on A1 shapes memory use
  too. The life uses little CPU and no network; keep backups off the VM
  regardless.
- **One observer, on the life's machine.** Viewers reach Caddy and the
  observer on the VM itself, which shares its one core with the life. Not
  load-tested.

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
node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --store /tmp/fly --check
npx vitest run src/bethesda/life
bash -n deploy/bethesda-life/install.sh && bash -n deploy/bethesda-life/backup.sh
```
