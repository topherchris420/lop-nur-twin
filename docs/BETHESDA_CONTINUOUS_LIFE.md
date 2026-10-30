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
Oracle Cloud VM since 2026-10-26 (criterion 8), and anyone can watch it.
That is one machine, not the production service: the store is a local
directory, not a transactional database. A read-only observer serves what
anyone may see of the life (criterion 6, [below](#witnessing-it)), and the
site's `/live` page, linked from the README but from nowhere on the site,
shows it (criterion 7); the Bethesda city itself
still runs its own local fly.

| Criterion                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Durable clock and snapshots | **Met on a filesystem.** `snapshot.ts` records the whole object graph of city and fly (every random stream's position, pending sensory frames, controller and navigation state, people), versioned by city, fly, ECHO and headless schema; sealed by SHA-256; written atomically. Older or newer versions are refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2. Crash recovery              | **Met in tests.** Restores are re-snapshotted and compared byte for byte, then stepped beside the uninterrupted life and compared at several intervals: the city with both controllers, and the fly in flight, landing, grooming and feeding. Corruption stops with the reason. A swat in progress has not been captured specifically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3. One writer                  | **Met on one machine.** An expiring lease, one file per epoch created exclusively; a replaced writer is fenced; a second continuation of a checkpoint is refused as a fork, never merged. Not a database lock; blue-green deployment untested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4. Wall-clock policy           | **Met: paused during outage.** A resumed life records a `gap` event (stopped, resumed, UTC) and computes no catch-up ticks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5. Bounded histories           | **Partly.** A checkpoint is bounded only by the city's replay limits (`REPLAY_LIMITS`), which are counts, not a sliding window: it grows from 8 MB at birth to 84 MB when the decision record reaches 60,000 decisions, after about 41 simulated hours, and then stops (measured; [below](#what-the-machine-needs)). Most of it is that record and the fly's static city geometry. Only the newest four keep their graphs. The chain of headers and life events grows by about a kilobyte per checkpoint (about 300 KB a day) and is not rotated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 6. Read-only observer API      | **Met on one machine.** About once a second the life writes an observation (`observation.ts`): individual, epoch, city, fly, ECHO and headless versions, tick, the head checkpoint and its UTC commit time, the fly's position, velocity, heading, mode, energy and counters, its recent decisions with reasons, the people outdoors near it, the city's wind (from `digital-fly/8`), and ECHO's self-model summary. It is made by reading the life only and never enters a checkpoint; a life observed every tick hashes the same as one never observed. A separate service serves it read-only as a witness that says `live`, `stale` (with the last observation) or `unavailable`, never an observation it could not validate; requests are rate-limited and streams capped per address. Public since 2026-10-26: Caddy on the VM serves it over HTTPS at `https://129-213-139-78.sslip.io` (a Let's Encrypt certificate Caddy renews), and the site's `/live` page reads it there. Not a database read; one observer, on the life's own machine; not load-tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 7. Visitor integration         | **Partly: a separate page.** The site's unlisted `/live` page follows the observer's stream: the fly on the city's imported map, its trail since the page opened, the people near it, its mode, energy, counters and recent decisions with reasons, the wind when the life reports one, its age and checkpoint, and its self-model when it has one. It interpolates only between two observations it received, never across a pause, and shows `stale`, `unavailable` or a lost observer instead of a fly of its own. Not done: the shared fly inside the Bethesda city view, which still runs its own local fly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 8. Operations                  | **Partly: one worker living on one VM.** `deploy/bethesda-life/` installs a hardened systemd service (restarted after a crash once the lease lapses, started at boot, checkpointed on stop, logged to the journal), a checksum-pinned Node, upgrades and rollbacks that switch only after the new release restores the head, and backups kept only if they restore. Since 2026-10-26 one individual lives on an Oracle Cloud `VM.Standard.A1.Flex` (1 OCPU, 8 GB, Ubuntu 24.04.5, arm64): `install.sh --create`'s trial life passed in 30 s at 1,335 MB peak resident memory, and the service committed its first verified checkpoint (12.4 MB) five minutes after the birth, with systemd's memory peak at 1.02 GB and no restart. `backup.sh` ran beside it 18 minutes after the birth ([below](#backup)). A reboot 26 minutes after the birth paused it openly: on the shutdown the service committed a last checkpoint (22.7 MB) in 9 s and stopped cleanly; it started 12 s after the kernel came up, resumed the same individual with no restart and recorded a 53 s gap. An upgrade to the release with the observer, 95 minutes after the birth, built it beside the running life, stopped it (a last checkpoint in 12 s), checked that the new release resumes the individual, and switched: the same individual resumed with no restart after a 37 s gap. Not yet run on the VM: a rollback and forced termination. Since 2026-10-30: [backups every 6 hours](#backup), each proven to resume and uploaded to an Oracle Object Storage bucket, and [a watcher outside it](#watching-it) that opens a GitHub issue when the life, its checkpoints or its backups stop; its first issue, opened before any upload, closed itself after the first one. Not done: a transactional database, spend limits (an Oracle budget only alerts), and blue-green deployment (an upgrade pauses the life). |

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
  archive only if an unpacked copy passes `--check`. `install.sh --backups`
  installs it with **`bethesda-life-backup.timer`**, which runs it every 6
  hours at the lowest priority and uploads each archive it keeps to an
  Oracle Object Storage bucket ([below](#backup)).
- **`.github/workflows/bethesda-life-watch.yml`** looks at all of it from
  outside every 15 minutes and keeps a GitHub issue open while anything is
  wrong ([below](#watching-it)).

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
people and vehicles outdoors within 40 m of it, from `digital-fly/8` on the
city's wind (its regime, speed and direction at 10 m, whether it gusts, and
its speed where the fly is), and with ECHO's controller a summary of its
self-model. A life born before `digital-fly/8` writes no wind, and the page
reads its observations still. It is made by reading the life only and written
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
the name, and opens TCP 80 and 443 in the VM's own firewall. The site's
`/live` page connects to that origin (`WITNESS_ORIGIN` in
`src/bethesda/live/witnessFeed.ts`, and the `connect-src` of every CSP copy):
a new name means changing both. A cloud firewall
in front of the VM must allow them too: on Oracle, two stateful ingress rules
in the subnet's security list, TCP 80 and TCP 443 from `0.0.0.0/0`.

Caddy also serves `GET /v1/backup`, the newest backup's record
([below](#backup)), and nothing else of the machine. After an upgrade that
changes the `Caddyfile`, run `public.sh` again: it validates the new file
before it replaces the one Caddy is serving.

### Upgrade

```sh
cd ~/lop-nur-twin && git fetch --depth 1 origin main && git checkout --detach FETCH_HEAD
sudo deploy/bethesda-life/install.sh
```

The first line moves the checkout to `main`'s newest commit by fetching it,
which also works on a shallow or detached checkout such as the VM's, where
`git pull --ff-only` does not. `install.sh` builds the new release beside
the running one, stops the service, and runs `--check` with the new
release. If the new release can resume the individual it switches to it and
starts it; if it cannot, it starts the old release again and exits with the
reason. `sudo deploy/bethesda-life/install.sh --rollback`
returns to the previous release, after the same check. The two newest
releases are kept, and so is every release a recorded continuation names as
its source (the `*_SOURCE` commits in `src/bethesda/life/`) or that
`/opt/bethesda-life/pinned` lists, one commit per line: those replay the
history the store holds. A release pruned before this rule, such as
`c8b5fb1`, is rebuilt from git as `build_release` builds any release.

A checkpoint is refused by any other city, fly, ECHO, headless or graph
version, so **an ordinary release that bumps any of those cannot continue this
individual**, and `install.sh` says so (for example
`checkpoint 0 is corrupt: made by fly digital-fly/7; this is digital-fly/8`).
Either stay on the release that is running, or end this individual's life
on this machine: stop the service, move the store aside and keep it (it is
the individual's whole record), and run `install.sh --create` for a new
individual on the new release. Never edit a checkpoint's versions to make it
load. The explicit ECHO continuations below are narrowly verified exceptions,
not permission to relabel an older checkpoint.

### Preserve the deployed individual while enabling ECHO v2

`scripts/bethesda-life-upgrade-echo.ts` supports one explicit transition:
the reduced-order individual on release
`c8b5fb163b22381fb08c3c0f4a18d5b92bfc2f4b` (`digital-fly/7`, ECHO v1)
to `digital-fly/8` with ECHO v2 (the deployed individual made it on
2026-10-27; on a release with ECHO v3 a reduced-order individual goes to v3
directly, since ECHO starts innate). It does not create a birth, change the
genesis, erase navigation memory, reset age, or replace the old controller's
state or random streams. It appends a checkpoint at the same tick and with
the same birth, linked to the previous checkpoint's digest.

The old engine first verifies and restores the source checkpoint. The
migration wraps the existing reduced-order controller in a new ECHO adapter,
adds its self-motion sense and the new wind fields/parameters, and fills
delayed sensory frames with the still-air readings valid before the upgrade.
In flight, old ground velocity is converted to the new air-velocity frame
without changing position or ground velocity. Removing only these declared
additions must reproduce the old graph's SHA-256 exactly, or nothing is
committed. The new checkpoint must restore byte for byte and continue
identically for 611 ticks after restore.

The `engine-upgrade` life event records the source release, exact parent,
old state/graph hashes, preserved-state digest, velocity conversion and UTC.
ECHO starts with innate beliefs **at the upgrade**, with no invented earlier
self-model memories. Existing navigation memories remain in the original
controller inside it. The next runner records the entire pause, including
migration time, as a gap. Future recovery remains exact under the new engine;
reproducing a life across this boundary also requires the recorded migration
and both engine releases, rather than replaying all ages on one engine.

Prepare and test against a verified backup first, while production keeps running:

```sh
sudo deploy/bethesda-life/install.sh --prepare
# In the prepared release, as bethesda-life, with a 4096 MB heap:
node scripts/run-ts.mjs scripts/bethesda-life-upgrade-echo.ts \
  --store /path/to/unpacked-backup/store \
  --from-release /opt/bethesda-life/releases/c8b5fb163b22381fb08c3c0f4a18d5b92bfc2f4b --check
```

`--check` is read-only: it never takes a writer lease or commits a copy of
the individual. After the backup test passes, stop `bethesda-life` gracefully,
make another verified backup with its old installed release, and run the
same command against `/var/lib/bethesda-life/store` with `--commit`.
It acquires the normal fenced lease only after all checks, refuses if the
head changed meanwhile, and publishes through `LifeStore`. Run `install.sh`
normally to check the upgraded head and switch to the prepared release.
Keep the final pre-upgrade backup and the old compatible release off-machine.
Never use `--create` for this operation.

Historical headers are checked against their exact registered versions and
seals. A version change without the matching upgrade event, a repeated
upgrade, an altered genesis, a backwards tick or a fork is refused. Old
checkpoints retain their seals; normal graph compaction still applies.
The ordinary `restoreLife` path continues to refuse all version mismatches.
After this transition, the old release cannot resume the upgraded head:
rollback across the boundary is refused, and a backup must never be used to
rewind an individual that has since continued.

### Continue the ECHO v2 individual on ECHO v3

`scripts/bethesda-life-continue-echo.ts` supports the next explicit
transition: the individual on release
`3db627bc125415093d6507988a2d8f61949f5240` (ECHO v2, after the upgrade
above) to ECHO v3 ([Project ECHO](PROJECT_ECHO.md#indicator-properties)).
The same individual keeps its whole self-model: its beliefs and their
uncertainty, its trust in its senses, its change detectors, an open inquiry,
its remembered episodes and its counts. Nothing else in the city or the fly
changes. v3 adds an empty workspace, an attention schema that has learned
nothing yet, the second look (an inquiry open at the upgrade starts without
one) and five counters at zero. Removing only these, and putting back the
self-model's three version labels, must reproduce the old graph's SHA-256
exactly, or nothing is committed. The `self-model-upgrade` life event
records the source release, the versions it goes from and to, the exact
parent, the old state and graph hashes, the preserved-state digest, whether
an inquiry was open, and the pause. Nothing before the upgrade is credited to
the new mechanisms.

The procedure is the one above, with this script and the v2 release:

```sh
sudo deploy/bethesda-life/install.sh --prepare
# In the prepared release, as bethesda-life, with a 4096 MB heap:
node scripts/run-ts.mjs scripts/bethesda-life-continue-echo.ts \
  --store /path/to/unpacked-backup/store \
  --from-release /opt/bethesda-life/releases/3db627bc125415093d6507988a2d8f61949f5240 --check
```

Then stop the service, back up with the v2 release, run it against the live
store with `--commit`, and run `install.sh` normally. The store's history
then holds three engines, each change attested by its own event, and the v2
release can no longer resume it.

### Continue the ECHO v3 individual as the organism

`scripts/bethesda-life-continue-organism.ts` supports the third explicit
transition: the individual on release
`d25e1f3b9e40c5ded3f8ce1f435365d5c6c80592` (ECHO v3) to the organism
(`bethesda-echo-organism/v1`; [the continuation](ECHO_ORGANISM_CONTINUATION.md)).
The same individual keeps its whole graph: its city, body, controller,
navigation memory, self-model and every random stream. Beside its own
controller and self-model it gains an innate mushroom body, odor filters at
rest, rested tissue under the recoverable physiology, and an archive of what
its bounded memories let go. Removing exactly those additions, and putting
back the adapter's class and descriptor, must reproduce the v3 graph's
SHA-256, or nothing is committed. The `organism-continuation` event records
the source release, the exact parent, the old state and graph hashes, the
preserved-graph digest, the descriptor it replaced, what was kept, what was
introduced, and the pause. Nothing before it is credited to the new parts.

Before continuing, `--check` steps the v3 fly 600 ticks in memory on the
deployed engine and on this release and requires identical hashes; after,
it requires the new checkpoint to restore and continue identically for 611
ticks. The procedure is the one above, with this script and the v3 release:

```sh
sudo deploy/bethesda-life/install.sh --prepare
# In the prepared release, as bethesda-life:
node --max-old-space-size=4096 scripts/run-ts.mjs scripts/bethesda-life-continue-organism.ts \
  --store /path/to/unpacked-backup/store \
  --from-release /opt/bethesda-life/releases/d25e1f3b9e40c5ded3f8ce1f435365d5c6c80592 --check
```

Then stop the service, back up with the v3 release, run it against the live
store with `--commit`, and run `install.sh` normally; the exact steps and
their checks are in [the cutover plan](ECHO_ORGANISM_CONTINUATION.md#cutover-plan).
The runner then commits the archive with its checkpoints (early, if it
fills) and stops rather than drop a record. The store's history holds four
engines, and the v3 release can no longer resume it. The deployed individual
was continued this way on October 28, 2026
([as it ran](ECHO_ORGANISM_CONTINUATION.md#the-cutover-as-it-ran)).

### Backup

```sh
sudo deploy/bethesda-life/install.sh --backups   # every 6 hours from now on; the life is untouched
sudo systemctl start bethesda-life-backup         # one now (journalctl -u bethesda-life-backup)
sudo deploy/bethesda-life/backup.sh              # or by hand → /var/backups/bethesda-life/bethesda-life-<UTC>-<commit>.tar.gz
ssh ubuntu@VM sudo cat /var/backups/bethesda-life/NAME.tar.gz > NAME.tar.gz   # a copy on your own computer
```

The archive is taken while the life runs (every file in the store is
published whole, so the copy holds the chain up to some checkpoint) and is
kept only if an unpacked copy passes `--check` with the installed release.
If the life commits while tar reads the store, tar reports that the store
changed, and the run copies it again, up to three times, 10 s apart. The
archive's name carries the commit of the release that wrote it.

`install.sh --backups` copies `backup.sh` to `/opt/bethesda-life/bin` and
installs `bethesda-life-backup.service` and its timer, without stopping or
changing the life; every later upgrade installs them again from its
checkout. The timer starts a backup at 00, 06, 12 and 18 UTC, up to 20
minutes late, and does not make up one missed while the machine was off.
Each timed run keeps the newest 8 archives (two days) in
`/var/backups/bethesda-life` and deletes older ones; by hand, `backup.sh`
keeps every archive unless given `--keep N`. `--keep` counts every archive
in that directory, those made by hand too: on the VM the service's first
run deleted the two oldest, and with them the only copy of the first
backup, taken 18 minutes after the birth. Before a first run with `--keep`,
copy elsewhere any archive that must stay. A boot-volume backup in the
console (five are free) is a second, whole-disk layer, not a substitute for
[off-site copies](#off-site-copies).

The check holds a whole life in memory beside the living one (3.36 GB at
its peak on the VM), so a run first asks whether the machine can spare
3,400 MB: what is available, less what the life may still grow to (its
high-water mark, at least its heap) and 512 MB. If it cannot, or while the
life is starting, or while another backup or `install.sh` is at work (they
share a lock), the run takes no copy and exits 75, and the next run tries
again. The service runs at the lowest CPU and I/O priority under a 4,608 MB
cap, and if memory runs out the kernel stops it first: its
`OOMScoreAdjust` is 1000, the life's 500.

Each run records what it did in `/var/lib/bethesda-life-backup/status.json`
(schema `bethesda-life-backup/v1`, parsed by `src/bethesda/life/watch.ts`):
the run (kept, skipped or failed, why, and what became of its off-site
copy), the newest archive kept (its name, SHA-256, size, individual,
checkpoint, tick and release, and its head checkpoint's digest and commit
time as the check verified them) and the newest one uploaded. Caddy serves
it at `/v1/backup` for the [watcher](#watching-it) and the
[ledger](#the-ledger). It holds nothing of the off-site URL. Records
written before `backup.sh` read the digest lack those two fields.

Before the timer, `backup.sh` ran once on the VM by hand, on 2026-10-26,
beside an 18-minute-old life with four checkpoints: it took 12 s, its check
peaked at 946 MB resident, and the archive (7.5 MB) streamed off the
machine matched its SHA-256. The life kept its clock throughout (600 ticks
a minute, the same process, no restart) and committed its next checkpoint
on time.

The timer was installed on 2026-10-30. The backup service's first run,
started by hand at 02:57 UTC beside a life at checkpoint 1018, passed the
memory gate and kept a 23 MB archive using 49 s of CPU; the timer's own run
followed at 06:06. The first upload came at 10:50, with checkpoint 1113:
the archive and its checksum reached the bucket `bethesda-life-backups`
(us-ashburn-1), and the watcher closed its issue a minute later. Through all
three the life kept the same process, with no restart. No copy has failed
its check there and no run has been skipped for memory, so neither refusal
has happened on a VM. One run has failed: at 12:48 that day the life
committed while tar read the store (`file changed as we read it`), and the
run stopped with no copy kept. A run by hand three minutes later kept
checkpoint 1137; runs since copy again instead of stopping.

A backup is this individual, not a copy of it. Restore one only in place of a
store that is lost or broken, and never run it beside a store that still
lives, on this machine or any other: two continuations of one individual
are a fork that no lease can see.

### Off-site copies

An Always Free VM can be reclaimed and a boot volume lost, so each archive
a run keeps is uploaded, with its `.sha256`, to an Oracle Object Storage
bucket (20 GB is Always Free). The VM holds a pre-authenticated request
that may only write objects: it can add archives but cannot list, read or
delete one, so whoever takes the VM cannot take the backups with it. Object
Storage refuses an upload that does not match the MD5 sent with it.

In the Oracle Cloud console, once:

1. **The bucket.** Storage → Buckets → Create bucket, for example
   `bethesda-life-backups`: Standard tier, **object versioning on**. A
   request that may write could replace an object under an existing name;
   versioning keeps the one it replaced.
2. **Retention.** On the bucket, a lifecycle policy rule that deletes
   objects older than 30 days, and one that deletes previous versions older
   than 30 days. Lifecycle rules need a policy that lets Object Storage act
   in the region (Identity → Policies):
   `Allow service objectstorage-REGION to manage object-family in tenancy`,
   with the bucket's region, such as `us-ashburn-1`.
3. **The request.** On the bucket, create a pre-authenticated request:
   target the bucket, **permit object writes** only (no object listing),
   and an expiry a year or more away. Note the expiry: uploads fail after
   it, and the watcher says so. Copy its URL, which ends in `/o/`; it is
   shown once.
4. **A budget.** Billing & Cost Management → Budgets: a monthly budget of
   $1 for the tenancy, with an alert at 100% of actual spend. Nothing here
   should cost anything, but a Pay As You Go tenancy pays for whatever
   exceeds the Always Free limits; a budget alerts, it does not stop it.

On the VM, keep the URL out of the shell's history and off every command
line. In an SSH session there, not a shell on your own computer, paste the
line `OFFSITE_URL=https://objectstorage...` after the second command, then
press Enter and Ctrl-D:

```sh
sudo install -d -m 0700 /etc/bethesda-life
sudo sh -c 'umask 077 && cat > /etc/bethesda-life/offsite.env'
sudo systemctl start bethesda-life-backup; journalctl -u bethesda-life-backup -n 8 --no-pager
```

From your own computer, the second command can run in one step, with the
same paste at the empty line it leaves:
`ssh -t ubuntu@VM "sudo sh -c 'umask 077 && cat > /etc/bethesda-life/offsite.env'"`.

The run's last line should be `off-site copy: uploaded`, and the archive
and its checksum appear in the bucket. The URL is a credential: `backup.sh`
uploads only when `offsite.env` is root's with mode 0600, passes the URL to
curl on its standard input rather than as an argument (any local user can
read another process's arguments), and removes any URL from what curl
prints. To replace it, write a new `offsite.env` and delete the old request
in the console.

The VM's request is `bethesda-life-backup-write`, on the bucket
`bethesda-life-backups` in us-ashburn-1, and it expires on 2027-10-30 at
11:30 UTC. The budget is `tenancy-monthly-1-usd`.

### Watching it

`.github/workflows/bethesda-life-watch.yml` looks at the life every 15
minutes from GitHub, through what anyone may read: the witness at `/v1/now`
and the backup's record at `/v1/backup`. When something is wrong it looks
again a minute later, and if it is still wrong it opens one issue labelled
`live-fly`. It comments on that issue only when the kinds of problem
change, and closes it when every check passes again. The same look by hand:

```sh
node scripts/run-ts.mjs scripts/bethesda-life-watch.ts --url https://129-213-139-78.sslip.io \
  --individual 04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921
```

| In the issue  | What it means                                                                                                    | What to do                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `unreachable` | Nothing answered at the observer's address: the VM, Caddy or the observer is down, or the way to it.             | Open the address yourself. Then the VM in the Oracle console (stopped, or reclaimed?) and, over SSH, `systemctl status caddy bethesda-life-observer`.        |
| `status`      | The witness is `stale` or `unavailable`: the life writes no observation (stopped, restarting or stuck).          | `systemctl status bethesda-life`, `journalctl -u bethesda-life -n 50`, and [Recovery](#recovery).                                                            |
| `individual`  | The observer shows an individual other than the deployed one.                                                    | Stop and find out how the store changed before doing anything else: nothing should change the individual.                                                    |
| `checkpoint`  | No checkpoint committed for 20 minutes; one is due every 5.                                                      | The journal, and [Recovery](#recovery): a commit that fails or takes too long.                                                                               |
| `backup`      | No archive kept for 13 hours (two runs), or never, or no record to read. The issue says what the newest run did. | `journalctl -u bethesda-life-backup`. Skipped for memory again and again: see [Known limits](#known-limits).                                                 |
| `offsite`     | No archive uploaded for 13 hours, or never. The issue says what became of the newest run's copy.                 | Not configured: [Off-site copies](#off-site-copies). Refused: `offsite.env`'s owner, mode or URL. Failed: often an expired or deleted request; make another. |

It sees only what GitHub's scheduler shows it: a scheduled run can start
late or be skipped when GitHub is busy, and GitHub stops scheduling it after
60 days without activity in the repository (re-enable it under Actions). A
failure of the workflow itself is reported by GitHub's email about failed
runs, not by an issue.

### The ledger

Every checkpoint names its parent's digest, so one digest fixes the
individual's whole history up to it. But that chain lives only on the VM,
which could rewrite it without anyone seeing. So the same workflow keeps a
public ledger (`src/bethesda/life/ledger.ts`): each time a backup has
verified a new checkpoint, it appends that checkpoint's sequence, tick,
digest and commit time, with the archive that holds it, as one line of
`ledger.jsonl` on the `live-fly-ledger` branch. GitHub records when each
line arrived; that, not the VM's clock, is the witness. The branch holds no
code, its `vercel.json` stops Vercel deploying it, and it is append-only:
nothing in it is edited, removed or force-pushed.

Any archive can be checked against every line:

```sh
git fetch origin live-fly-ledger && git show origin/live-fly-ledger:ledger.jsonl > ledger.jsonl
tar -xzf bethesda-life-<UTC>-<commit>.tar.gz -C /tmp/check
node scripts/run-ts.mjs scripts/bethesda-life-ledger.ts verify --store /tmp/check/store --ledger ledger.jsonl
```

It checks the archive's whole chain first, then judges each line:
**confirmed** (the archive holds that checkpoint with that digest, even
after compaction dropped its graph), **contradicted** (it holds a different
checkpoint there, or another individual: the history was rewritten, or lost
to a restore from an older backup, which the ledger then shows openly), or
**ahead** (the archive ends before it). It exits 1 if any line is
contradicted. Tried on the archive of 2026-10-30 02:57 (1,019 checkpoints):
the chain verified in 19 s on a laptop, and planted lines were confirmed,
contradicted and ahead as they should be.

A line says only that the VM claimed that checkpoint by the time GitHub
received it, at most about 6 hours after it was committed (one backup).
Anyone who can push to the repository could still rewrite the branch: a
ruleset that refuses force pushes and deletion on it, or a copy of the
ledger elsewhere, guards against that.

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

When the VM is lost, the newest archive is in the bucket. Download it and
its `.sha256` in the console (the request the VM held cannot read), check
it with `sha256sum -c NAME.tar.gz.sha256`, copy it to the new machine, and
restore it as above.

### Known limits

- **Upgrades pause the life**, and a version bump ends it on this machine
  (above). Blue-green deployment is untested.
- **Starting and committing take longer as the life ages.** Opening the
  store reads every checkpoint from birth, and each commit re-reads every
  older header to drop graphs: 288 more files for every simulated day. Not
  yet measured on a long chain.
- **Oracle may reclaim an Always Free VM it deems idle**: 95th-percentile
  CPU and network use under 20% for 7 days, and on A1 shapes memory use
  too. The life uses little CPU and no network; the off-site copies are
  what survives that.
- **A backup's check needs 3.4 GB beside the life**, and grows with the
  head checkpoint. If runs are skipped for want of memory again and again,
  give the VM more (the Always Free A1 allowance is 24 GB; a resize reboots
  it, a gap), or take a backup with the life stopped (also a gap):
  `systemctl stop bethesda-life`, `backup.sh`, `systemctl start bethesda-life`.
- **The watcher is one scheduled job on GitHub** ([above](#watching-it)):
  it can be late, and it cannot report its own absence.
- **The ledger trusts GitHub** ([above](#the-ledger)) and anchors one
  checkpoint per kept backup, so it fixes the history up to about 6 hours
  ago, and nothing from before it began except through the chain.
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
node scripts/run-ts.mjs scripts/bethesda-life-watch.ts --url https://129-213-139-78.sslip.io --individual 04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921
node scripts/run-ts.mjs scripts/bethesda-life-ledger.ts verify --store /tmp/check/store --ledger ledger.jsonl
```
