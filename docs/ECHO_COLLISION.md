# ECHO collision repair: a body cannot enter a solid, and the deployed fly's life is kept

**Status: the repair is written and rehearsed on copies. It has not been applied to the
deployed fly.** Until an entry in [The cutover, as it ran](#the-cutover-as-it-ran) says
otherwise, the deployed fly is on `digital-fly/8`, in the building described below.

`digital-fly/9` fixes how a moving body meets a surface, everywhere in
`src/bethesda/fly/`, with no rule about any one building. A recorded continuation
carries the same individual across: one label changes in its graph, and everything else
stays byte for byte. It does not move the body. The repaired physics lets a body that
is already inside a solid leave, and on a copy of the deployed fly that is what happened
([the rehearsal](#the-rehearsal)).

## What went wrong

### The deployed fly

From the journal and the verified backups, read-only. Individual
`04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921`, release
`bdb7c02a5cf0b9040be81e0435ae49c8ec9e90b1`.

- **It entered building 1011267786 between 17:12:45Z and 17:13:45Z on 2026-11-01**
  (ticks 5279154 and 5279754), after resting on the wall's line at
  (475.033, 12.809, 628.854) two minutes before. It is the only time it has been inside
  a solid in its life.
- **It stayed inside.** From entry to 2026-11-03 21:32Z, 3125 of 3125 one-minute samples
  are inside the same solid. It still moved, by flight, within x 464.76 to 477.63 and z
  628.58 to 646.23.
- **It has not eaten since.** Meals stand at 161, the last at 08:20:41Z on 2026-11-01, 9
  hours before it went in. Before entry it averaged 1.098 meals an hour. Inside, no odor
  reaches it, and the nearest food is 128.25 m away.
- **Its energy is not stable.** It is a sawtooth between 0.080 and 0.350 of capacity, held
  up by artificial maintenance (recovery bouts 33 to 69, maintenance 12.815 to 26.879 J).
  It spends 0.269 J/h inside and spent 0.112 J/h before. Any single reading, such as 33%,
  is one point on that sawtooth.
- **Its record is whole.** 2353 checkpoints, no parent mismatch, 767 archived episodes, 7
  associative updates, and 8 recorded gaps. Its self-model has run no inquiry since it
  went in (909), and it walked no further (2224 m).

### How a body gets in

The first measurements are in [`ECHO_RANGING.md`](ECHO_RANGING.md#flies-inside-buildings).
Three defects combine:

1. `solid` and the ray test disagree about a point on a wall's line. Walking is
   end-checked with steps that shrink at an edge, so a fly can come to rest within about
   2e-14 m of the line, where `solid` says outside and the ray computes a slightly
   negative distance and discards the wall.
2. `move` trusted the ray. A step that hit nothing went ahead, even if it ended inside a
   solid. So did the end of a slide.
3. `settle` stood a landing fly at standing height without checking that point. Where a
   building's floor is lower than a fly stands, as on a slope, the body went into the
   floor. This is seed 205.

And from inside, rays hit every wall normally, so nothing let a body out.

### Which surfaces can do it

On the real map on `digital-fly/8`, a point was bisected onto the line of each surface
from outside, and a 3 mm ray was cast from it toward the surface
([`survey.ts`](research/echo-collision/survey.ts)):

| Solid            | Rays that missed |
| ---------------- | ---------------- |
| Prism wall       | 2774 of 17999    |
| Box              | 1 of 11966       |
| Tapered cylinder | 2 of 6945        |
| Ellipsoid        | 0 of 7946        |
| Sphere           | 0 of 132         |
| Ground           | 0 of 13485       |
| Roof             | 0 of 291         |

So this is general to prism walls, not one building. Only prisms hold a body from inside.
On the map: 1166 prisms, 2739 boxes, 1168 cylinders, 3866 spheres and 140 food sources;
the thinnest box is 0.06 m, the thinnest cylinder 0.11 m, the smallest sphere 0.46 m, and
the shortest wall edge 0.19 m. Under building 533702831, seed 205's, the ground is below
the floor in 424033 of 1149926 cells, and 11 prisms have such a gap at some corner.

## The fix

All of it is in `src/bethesda/fly/`, and `FLY_VERSION` is `digital-fly/9`.

- **`sweep` in `world.ts`** answers what `move` needs: the first surface a step meets.
  It asks `solid` as well as the ray at a millionth of a metre along the step. A ray that
  disagrees is overruled: the step is stopped there, from the line. No epsilon is added
  to any test, so nothing changes for a step that meets no defect.
- **`move`** uses `sweep` for its step and for its slide. A step that would still end
  inside a solid does not happen, and a slide's end is checked the same way.
- **`settle`** refuses a stand whose point is solid, with a reason. A fly with no room to
  stand stays in the air.
- **`keepContact`** drops a contact inside a solid, so a body inside cannot stand there.
- **Coming out is free.** A surface stops a body going in, never one coming out. That
  matters for any solid: a checkpoint can only be repaired if its body can leave.

Walking is unchanged: its steps are at most 0.2 mm and end-checked, against a thinnest
solid of 60 mm. Nothing about what the fly decides changed: no controller, adapter,
learning rule or goal. Only where a command's motion ends can differ, and only where it
would have ended inside a solid.

`src/bethesda/life/acquired/wallGuard.ts`, the research-only stand-in, stays for the runs
made with it, and now has nothing to refuse.

## Continuing the deployed fly

The fly's hash names its version, so this release cannot resume a real `digital-fly/8`
checkpoint under any kind. That is deliberate: no checkpoint is silently run under new
physics. The transition is `scripts/bethesda-life-continue-physics.ts`
(`src/bethesda/life/physicsRepair.ts`), following the
[earlier continuations](ECHO_ORGANISM_CONTINUATION.md):

- **The same individual.** Birth, genesis digest and tick are unchanged. The new
  checkpoint's parent is the exact head.
- **One leaf changes**, `cityFly.fly.adapter.model.state.fly`, the self-model's note of
  which fly it is, from `digital-fly/8` to `digital-fly/9`. Putting it back must give
  the source's graph digest, or nothing is committed.
- **The body is not moved.** `physicsRepairProjection` holds the rest of the graph to the
  source, so a forged repair that moves the body is refused when the chain is checked.
- **One `physics-repair` event**, at the unchanged tick, records the parent, the source
  state and graph hashes, the preserved digest, the source release, the two versions, the
  leaf, where the body was, what was kept, the pause, and this:

  > an environmental repair made by the people who keep this simulation: a change to how
  > the world's surfaces hold a body, not something this fly did, learned or found its
  > way to

- **Every crossing is written down.** From then on the archive records
  `body-left-solid` and `body-entered-solid` with position, mode and physics version.
- **The pause is not lived.** The runner records one gap from the source's last commit.
- **Every older checkpoint keeps its seals,** and stays checked by the rules of its own
  era: `ORGANISM_V1_LIFE` freezes the organism on `digital-fly/8`. As at every commit, the
  store's compaction drops the graph of the checkpoint that leaves its window of four.

## The evidence

All of it is on copies and research flies. A copy is never the individual, and what it
does is no part of the individual's history. Linux arm64 on Node 24.22.1 is the VM's
platform; a fly's arithmetic is only comparable there.

### Research flies

Run [41727492979](https://github.com/topherchris420/lop-nur-twin/actions/runs/41727492979)
at `d24c23d`, 96 simulated hours each, records in
[`benchmarks/echo-collision/2026-11-03/flies/`](benchmarks/echo-collision/2026-11-03/flies/).

| Physics         | Seeds   | Trapped | Seconds in a solid | Mean meals | Fewest | Mean meals by day      |
| --------------- | ------- | ------- | ------------------ | ---------- | ------ | ---------------------- |
| `digital-fly/8` | 301–312 | 9 of 12 | 1,347,336          | 83.5       | 17     | 36.5, 21.8, 16.7, 8.6  |
| `digital-fly/9` | 301–312 | 0 of 12 | 0                  | 120.0      | 83     | 37.9, 25.2, 27.9, 28.9 |
| `digital-fly/9` | 181–192 | 0 of 12 | 0                  | 118.7      | 97     |                        |
| `digital-fly/9` | 201–212 | 0 of 12 | 0                  | 133.1      | 95     |                        |

- **Seven buildings trapped the old flies,** among them 1011267786, where seeds 302 and
  310 ended up.
- **Physics, not the controller.** The defect never reached seeds 301, 306 and 312, and
  they ate the same meals and flew the same distance under both (113 and 34,958 m, 117
  and 37,800 m, 111 and 34,791 m).
- **Going hungry is still possible.** 3 of the 144 repaired fly-days held no meal. Across
  the 36 lives, a fly's longest stretch without one had a median of 15 hours and a
  maximum of 30.

### Pilots and calibration

All nine pilots were re-recorded on Node 24.19.0, Windows ARM64. Every output is the same
bytes, and only labels and the hashes that name them moved, so no demonstration needed
re-sizing. The calibration's refit and report changed the version they name and nothing
else.

### The rehearsal

Run [41729219898](https://github.com/topherchris420/lop-nur-twin/actions/runs/41729219898),
`scripts/bethesda-life-rehearse-physics.ts` at `4481891` (later commits to the script only
satisfy the linter) on a copy of backup
`bethesda-life-20261103T180906Z-bdb7c02a5cf0.tar.gz`, head 2352, 72 simulated hours, with
a stop and start at the halfway mark. Its samples are in
[`rehearsal/`](benchmarks/echo-collision/2026-11-03/rehearsal/).

**At the boundary:** the same individual, birth, genesis and tick, the graph kept, and no
field different but the one leaf. The old and new physics ran identically for 2,200 ticks
from the head and then parted.

**After it:** the body left the solid 214 simulated seconds after the repair, in flight,
at (464.68, 13.53, 632.19), and did not go back into one in the 72 hours. The stop and
start changed nothing, the service's runner then ran on it, and the chain verified
at 3,220 checkpoints.

| Reading                | At the repair | After 72 hours |
| ---------------------- | ------------- | -------------- |
| Meals                  | 161           | 234            |
| Reserve                | 0.21          | 0.44           |
| Distance flown (m)     | 81,326        | 113,622        |
| Recovery bouts         | 67            | 84             |
| Energy from food (J)   | 19.8          | 31.2           |
| Energy from upkeep (J) | 26.1          | 32.7           |
| Self-model inquiries   | 909           | 1,403          |
| Mushroom-body trials   | 7             | 20             |
| Commands rejected      | 0             | 0              |

The meals came 19, 26 and 28 to a day, and the longest gap between them was 12 hours. Its
reserve kept to 0.08 to 0.98, and it ranged across the city, x from -21.6 to 483.5.

**Its first meal came 8.4 hours after the repair.** For about 8 hours it stayed at the
city's east end, as flies there do, resting and recovering. Then it made long flights to
a patch about 295 m from where it had been resting, its log reading "round an obstacle"
on the way and "cruise in food odour" as the odour rose from 0.02 to 0.28.

**What each part is, and is not:**

- **Leaving the building is the repaired physics.** Nothing the fly learned or found out
  got it out.
- **The recovery bouts are programmed maintenance,** the deliberately artificial supply
  the organism already had, and they are not food. It still needs them: over the 72
  hours they supplied 6.6 J against food's 11.4 J.
- **Finding its first food is its existing search and odour-following.** That is
  autonomous navigation, with nothing added, and it is not newly learned.
- **Going back to food is memory from its own meals, by a rule it already had.** Its
  first meal stored a place. From 9.1 hours it flew back to remembered food at least 17
  separate times, as far as 284 m, and held a place in 46% of the samples, up to 4 at
  once. So where it flew depended on where it had eaten. Nothing here shows it eats more
  because of that: the meals rose day by day, but the first day lost 8.4 hours and there
  is no control.

### Replay

Run [41747963788](https://github.com/topherchris420/lop-nur-twin/actions/runs/41747963788),
on a copy of a newer backup, head 2423: the continuation, then 18,000 ticks observed as
the service observes. The scheduled replay's path reproduced 3 of 3 seals, and a replay
from the continuation itself 6 of 6, with all 14 public ledger anchors in the chain.
Straight after the commit there is nothing to judge, and it says so (exit 75).

The release on the VM cannot pass this. Its observer left traces in sealed lookup caches
while the fly flew, so its seals cannot be reproduced (issue 162). This release has that
fix (`9c029f7`), so the same check should pass on the VM after the cutover. Only a real
replay there can show it.

### The commands, in order

Run [41752780859](https://github.com/topherchris420/lop-nur-twin/actions/runs/41752780859):
every step of [the plan](#cutover-plan) in order, as root, on a disposable Linux arm64
machine with 4 cores. `install.sh` installed the deployed release with a copy of the newest
backup in place, and the copy lived as the service lives, at its real 2,560 MB heap with
the observer watching. An earlier run,
[41748526687](https://github.com/topherchris420/lop-nur-twin/actions/runs/41748526687), did
the same as far as step 9 and then stopped on a mistake in the test, which looked for the
replay script in the release's folder.

| Step                 | Seconds | Result                                                                   |
| -------------------- | ------- | ------------------------------------------------------------------------ |
| 1. Prepare           | 5       | Built beside the running release, which ran on                           |
| 2. Backup            | 28      | Kept, and it resumed                                                     |
| 3. Check             | 83      | Passed beside the service, at 3,886 MB, and changed nothing              |
| 4. Stop              | 20      | A last checkpoint, and the lease released                                |
| 5. Final backup      | 28      | Kept, and it resumed                                                     |
| 6. Commit            | 117     | Checkpoint 2428 at the unchanged tick, with the graph kept               |
| 7. Switch and start  | 126     | The new release living, including 90 s of watching it                    |
| 8. Verify            | 45      | 2,431 checkpoints, and the witness live on `digital-fly/9`               |
| 9. Backup            | 39      | Kept, on the new release                                                 |
| The scheduled replay | 63      | 2 of 2 seals, from the service's own chain, with the ledger's 14 anchors |

Three refusals ran as well, and none changed anything:

- **An ordinary upgrade before the commit:** "checkpoint refused: made by fly
  digital-fly/8; this is digital-fly/9". The old release was running again in 36 s.
- **A second commit:** "this individual is already on the repaired physics; nothing was
  changed".
- **`install.sh --rollback` after the commit:** "checkpoint 2428 is corrupt: made by fly
  digital-fly/9; this is digital-fly/8". The new release was running again in 26 s, and its
  next checkpoint followed on the same chain, which then verified at 2,433 checkpoints.

### What this does not show

- **Nothing about the deployed fly.** The deployed fly's head has moved on since these
  backups, so its timing will differ from any copy's.
- **Why flies linger at the east end.** They find less food there (2.24 meals per 3 hours
  east of x = 359, against 4.90 west of it), and the cause is still unexplained.

## Cutover plan

**Each step that changes the VM needs the owner's explicit approval, given for this
cutover. This document is not that approval.** It is the procedure the
[organism's continuation](ECHO_ORGANISM_CONTINUATION.md#cutover-plan) used, with this
script.

**Maintenance window:** one pause, from the service's stop to its start on the new
release, budgeted at 15 minutes. Nothing is computed during it. The runner records it as
one gap from the deployed release's last commit, and no experience is attributed to it.

**Before the window (the fly keeps living):**

1. Merge this branch after review. On the VM:

   ```sh
   cd ~/lop-nur-twin && git fetch --depth 1 origin main && git checkout --detach FETCH_HEAD
   sudo deploy/bethesda-life/install.sh --prepare
   ```

   It builds the release beside the running one and stops nothing. Record its commit.

2. `sudo deploy/bethesda-life/backup.sh`. Copy the archive off the VM and check its
   SHA-256 there.
3. `sudo bash docs/research/echo-collision/vm-physics-check.sh BACKUP RELEASE`, with the
   archive from step 2 and `/opt/bethesda-life/releases/COMMIT`. It runs the
   continuation's `--check` on a copy that is read-only to the service's user, beside the
   service, under a memory cap, as the kernel's first out-of-memory victim. It starts
   only if memory holds the check and the service at their peaks. If it does not, it
   stops and changes nothing, and step 6's identical checks are then the first to run on
   this machine. Expect the same individual, the head's tick, `preservedGraphDigest`
   equal to `sourceGraphDigest`, and the same-engine and restore checks passing. Any
   difference stops the cutover.

**Approval.** The owner reads step 3's output, or the reason it did not run, and approves
the window, or not. Nothing below happens without that.

**In the window:**

4. `sudo systemctl stop bethesda-life`. Wait for the final checkpoint and the lease's
   release, and confirm the process is gone. Record the time.
5. `sudo deploy/bethesda-life/backup.sh` again: the last backup on the old physics. Copy
   it off the VM, check its SHA-256 and keep it with release `bdb7c02`.
6. `sudo bash docs/research/echo-collision/vm-physics-commit.sh RELEASE`. It repeats every
   `--check` step, takes the lease only after all of them pass, refuses if the head
   changed, and publishes one checkpoint through `LifeStore`. It runs as its own transient
   unit, so a dropped connection cannot stop it halfway. Keep its output.
7. Straight after it, `sudo deploy/bethesda-life/install.sh`, an ordinary upgrade: it
   checks that the release resumes the store, switches to it, keeps `bdb7c02` and the
   older pinned releases for replay, and starts the service.

**After the window:**

8. Verify: the service is active with no restarts, `--verify` passes, the witness shows
   the same individual with a tick that keeps rising from the continuation's, the next
   checkpoints commit with one gap recorded, and no command is rejected.
9. Take a backup on the new release and check that it passes `--check`. Only then may
   anyone say the deployed fly continues on the repaired physics.
10. Watch it. The VM runs one simulated hour per real hour, so most of what matters takes
    real time:
    - **Out of the solid:** a `body-left-solid` event, then the position against the map
      minute by minute. Not until the deployed fly has been seen outside may anyone say
      it left, and then only as what the repaired physics allowed.
    - **Staying out:** no `body-entered-solid` event, ever.
    - **Eating:** `meals` rising above its count at the continuation.
    - **The record:** the next scheduled replay passes with seals required, on an archive
      that holds checkpoints from this release.

**To abort at any point before step 6 commits:** `sudo systemctl start bethesda-life`. It
is still `bdb7c02`, and nothing has changed (`--prepare` switches nothing). The pause is
recorded as a gap like any other.

## Rollback limits after the commit

Once the continuation is committed, `bdb7c02` refuses the store and fails closed, and no
engine converts it back. `install.sh --rollback` refuses too. Until step 7 switches
releases, a start of the old service, by hand or by systemd after a reboot, fails the same
way and writes nothing, so steps 6 and 7 run back to back.

- **If the new release fails before it commits any tick,** the store's head is the
  continuation itself, at the old head's tick, with nothing lived after it. Restoring the
  step 5 backup then loses no experience, but it does discard a committed checkpoint. It
  needs its own approval, the failed store kept aside and never run, and the discarded
  continuation recorded.
- **Once the fly has lived on the new physics,** restoring an older backup would erase
  that life and fork the individual. It is never reported as uninterrupted continuity.
  Prefer a new, recorded continuation that keeps the history. If a restore is
  unavoidable, stop every other writer, keep the failed store, record the lost interval
  and its parentage, and get approval for that specific recovery. The public ledger shows
  a rewind for what it is.

## The cutover, as it ran

It has not run. Nothing in this document has been done to the deployed fly.
