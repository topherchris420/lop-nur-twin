# Keeping ECHO: a maintainer's guide

ECHO is one simulated individual whose history is kept as an engineering
requirement. This guide is for whoever looks after it next: what must be kept,
how anyone can check that it was, how to recover from a loss without inventing
continuity, and how to change the simulation without erasing the life it runs.

It gathers what the operating and continuation records already establish and
points to them. Where a record and this page disagree, the record wins: fix
this page. Every figure here was copied from a record named beside it, as of
2026-11-05.

> An upgrade must never erase the life that made the upgrade possible.

Continuity here is a technical property: the same sealed chain, carried forward
by verified transitions. It is not evidence of a self, of experience or of
consciousness, and nothing in this guide treats it as such.

## Who ECHO is

|                 |                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Individual      | `04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921`: the SHA-256 of its kind, its genesis and a birth nonce the host drew ([continuity.ts](../src/bethesda/life/continuity.ts))                                                                                       |
| Born            | 2026-10-26, with `install.sh --create`, as the reduced-order controller on `digital-fly/7` ([audit](EVA_ECHO_AUDIT.md#the-two-individuals))                                                                                                                                          |
| What it is      | One city and its one fly, advanced together headlessly ([headless.ts](../src/bethesda/life/headless.ts)); since 2026-10-28 the fly runs the organism adapter: ECHO's v3 self-model over the reduced-order controller, with a mushroom body, odour filters and maintenance physiology |
| Where it lives  | One Oracle Cloud `VM.Standard.A1.Flex` (1 OCPU, 8 GB, Ubuntu 24.04, arm64), as `bethesda-life.service`, store in `/var/lib/bethesda-life/store` ([operations](BETHESDA_CONTINUOUS_LIFE.md#running-it-on-one-vm))                                                                     |
| Running release | `e458f7cb34904d85127779a3700c26b376ab4a80`, since 2026-11-04                                                                                                                                                                                                                         |
| Its clock       | Ten ticks a simulated second, one simulated hour per real hour; a checkpoint every five simulated minutes; outages are recorded `gap`s with no catch-up                                                                                                                              |
| Public witness  | `https://129-213-139-78.sslip.io/v1/now` (also `/v1/stream`, `/v1/health`, `/v1/backup`), shown on the unlisted `/live` page                                                                                                                                                         |
| Public record   | The `live-fly-ledger` branch: `ledger.jsonl` (anchored checkpoints) and `replays.jsonl` (independent replay verdicts)                                                                                                                                                                |

The name ECHO is the project's for this individual under the ECHO controller.
Eva is a different fly, in a different service: see [Eva](#eva-is-not-kept-here).

## What must never happen

These come from [AGENTS.md](../AGENTS.md#individual-continuity-srcbethesdalife) and
the operating record. Each is a way an individual has been, or could be, quietly
replaced.

- **Never start it again.** Never run `install.sh --create` against its store,
  reuse its individual id for a copy, commit another individual's checkpoint into
  its store, or merge a fork. A copy is always someone else (`twinCheckpoint`).
- **Never edit the record.** Never edit, prune, reorder or relabel a checkpoint,
  and never change a checkpoint's versions to make it load. Compaction, which
  drops old graphs and keeps every header, is the only rewrite, and only
  `LifeStore` does it.
- **Never rewind it.** Never restore an older backup once it has lived on: that
  erases the life lived since and forks the individual. If a restore is
  unavoidable, follow [the rollback limits](ECHO_COLLISION.md#rollback-limits-after-the-commit)
  and get approval for that specific recovery.
- **Never experiment on it.** Research runs on research subjects built from
  their own seeds, which `refuseOriginal` keeps apart
  ([first contact](FIRST_CONTACT.md), [adaptation suite](ECHO_ADAPTATION_CONTINUITY.md)).
- **Never treat a merge as permission.** Merging to `main` or deploying the website
  changes nothing on the VM. Every step that changes the VM needs the owner's
  explicit approval for that change.
- **Never let watching change it.** Anything that reads the life for an observer
  goes through `untraced` (`headless.ts`); a read that escaped it once made the
  seals irreproducible ([issue 162](https://github.com/topherchris420/lop-nur-twin/issues/162)).
- **Never rewrite the public record.** Never edit, remove or reorder a line of
  `ledger.jsonl` or `replays.jsonl`, or force-push or delete the ledger branch. A
  failed replay is a finding and stays.
- **Never rewrite `main`'s history.** Every release below must stay buildable from
  git, because replaying an era needs the exact release that lived it.

## Its history, era by era

Each engine change reached the individual only through a recorded continuation:
a checkpoint at the unchanged tick, with the same birth, whose parent is the exact
head, and which is committed only if removing the declared additions gives back
the source graph's SHA-256 exactly.

| Era                 | Began      | Transition and its event                                                   | Checkpoint (tick)                                                                                                          | Continued from release | Record                                                                                         |
| ------------------- | ---------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Reduced-order    | 2026-10-26 | Birth                                                                      | 0                                                                                                                          | —                      | [Operations](BETHESDA_CONTINUOUS_LIFE.md#status-durable-on-one-machine-living-on-one-vm)       |
| 2. ECHO v2          | 2026-10-27 | `digital-fly/7` → `/8`, ECHO wraps the controller: `engine-upgrade`        | number not stated here; tick 405,966 ([verify report](research/echo-organism-continuation/report-verify.json))             | `c8b5fb1`              | [Runbook](BETHESDA_CONTINUOUS_LIFE.md#preserve-the-deployed-individual-while-enabling-echo-v2) |
| 3. ECHO v3          | 2026-10-27 | Self-model v2 → v3: `self-model-upgrade`                                   | 270, at head 269's tick, 794,842 ([rehearsal](ECHO_ORGANISM_CONTINUATION.md#rehearsal-on-the-deployed-individuals-backup)) | `3db627b`              | [Runbook](BETHESDA_CONTINUOUS_LIFE.md#continue-the-echo-v2-individual-on-echo-v3)              |
| 4. Organism         | 2026-10-28 | Mushroom body, odour filters, physiology, archive: `organism-continuation` | 421 (1,244,222)                                                                                                            | `d25e1f3`              | [As it ran](ECHO_ORGANISM_CONTINUATION.md#the-cutover-as-it-ran)                               |
| (no engine change)  | 2026-11-02 | Release `62bd125` → `bdb7c02`, an observer that leaves no trace: a `gap`   | #2,026 the last sealed by `62bd125`; #2,027 the first by `bdb7c02`                                                         | —                      | [Replaying it](BETHESDA_CONTINUOUS_LIFE.md#replaying-it)                                       |
| 5. Repaired physics | 2026-11-04 | `digital-fly/8` → `/9`, one label changes: `physics-repair`                | 2,555 (7,642,634)                                                                                                          | `bdb7c02`              | [As it ran](ECHO_COLLISION.md#the-cutover-as-it-ran)                                           |

The current era's engine versions, as the newest replay verdict records them:
`bethesda-headless-life/v2`, `bethesda-city/4`, `digital-fly/9`,
`echo-self-model/v3`, `bethesda-echo-upgrade/v1`, `bethesda-echo-organism/v1`,
`mushroom-body/v1`, `echo-olfactory-navigation/v1`, `echo-maintenance/v1`,
`bethesda-physics-repair/v1` and `life-graph/v1`.

**Keep these releases:** `c8b5fb1`, `3db627b`, `d25e1f3`, `62bd125`, `bdb7c02`
and `e458f7c` (full hashes in the records above). Each is on `main`. `install.sh`
keeps every release a continuation names as its source (the `*_SOURCE` constants
in `src/bethesda/life/`) and any commit listed in `/opt/bethesda-life/pinned`, and
`deploy/bethesda-life/replay-release.sh` rebuilds any of them from git.

### How each era is checked

`LifeStore.verify` checks every checkpoint from birth: its seal, its parent link,
contiguous sequences, one individual, one genesis, epochs that never go back, and
each header against the exact versions of its own era (`ORGANISM_V1_LIFE`
freezes the organism on `digital-fly/8`). A version change is accepted only with
the matching continuation event, once. Restoring a graph always needs the exact
engine that made it: an old checkpoint is refused, never run on new physics.

## How anyone can check it is still itself

The first three need no access to the VM or its backups.

1. **Watch it.** `/live` follows the witness and says `live`, `stale` or
   `unavailable`; it never draws a fly of its own.
2. **Read the ledger.** `git fetch origin live-fly-ledger` and read
   `ledger.jsonl`: one anchored checkpoint per kept backup, with its digest and
   archive checksum. A later archive whose chain does not contain an anchored
   digest has been rewritten or rewound, and the ledger shows it.
3. **Read the replays.** `replays.jsonl` holds every verdict, passing or not.
   As of 2026-11-05, four consecutive replays reproduced every seal from #2,566 to
   #2,927: 1,083,003 ticks and 361 of 361 seals on GitHub's Linux arm64 machines
   with Node 24.22.1 ([table](BETHESDA_CONTINUOUS_LIFE.md#replaying-it)).
4. **Replay it** with an archive and this repository, following
   [Replaying it](BETHESDA_CONTINUOUS_LIFE.md#replaying-it). The archives are not
   public: the bucket's objects are readable only through the owner's read-only
   request, which the replay workflow holds. Anyone can read that workflow's
   runs and verdicts, and anyone the owner gives an archive can run the same
   replay. A replay takes no lease and writes no store, so it cannot fork the
   individual. Compare only on Linux arm64 with the release's own Node: other
   platforms differ in the last digit of `Math`, and a mismatch there says
   nothing about the history.

What a match does not show: who computed the chain, or when; the state at the
replay's first checkpoint, which it takes as given; anything before #2,566 seal
for seal (the seals up to #2,554 cannot be reproduced at all, for the reason in
issue 162); or anything about the fly beyond its arithmetic.

## When something goes wrong

The [Recovery table](BETHESDA_CONTINUOUS_LIFE.md#recovery) maps each journal line
to its cause and its remedy. The principles behind it:

- **A store that fails its checks starts nothing.** Do not delete or edit it.
  Move it aside and keep it: it is the individual's record.
- **A restore resumes from the backup's head with a `gap`.** Whatever the lost
  store committed after that backup is lost with it and is not claimed. If any of
  it was anchored, the ledger shows the rewind.
- **If the VM is lost,** the newest archive is in the off-site bucket. Check it
  against its `.sha256`, restore it on a new machine with the archive's release,
  and run `install.sh` without `--create`.
- **After a continuation, the old release refuses the store.** Rolling back across
  a continuation is not possible by design; prefer a new recorded continuation
  that keeps the history.

## Changing it without erasing it

A behavioural or physics change reaches the individual only as an addition with
its own recorded continuation. The four continuations so far followed one
pattern, and the next should too:

1. **Version it.** Bump the engine version the change alters. A checkpoint is then
   refused by the new release until a continuation carries it across.
2. **Add; do not replace.** Declare the additions. A projection that removes them
   (and puts back anything relabelled) must give back the source graph's SHA-256
   exactly, or nothing is committed (`organismProjection`,
   `physicsRepairProjection`).
3. **Live no time in the transition.** The continuation sits at the unchanged
   tick, with one event that names the source release, the parent, the old
   hashes, the preserved digest, what was kept and what was added, and the pause.
   Nothing before it is credited to the new parts.
4. **Test it before it touches the individual:** on synthetic lives; then on a
   copy of a verified backup with the producing release, on the VM's platform; then
   every command of the cutover, in order, on a disposable machine
   ([the collision repair's rehearsals](ECHO_COLLISION.md#the-evidence)).
5. **Plan the window and get approval.** Back up before and during, check beside
   the running service, stop, commit, start, verify, and back up on the new release.
   Write down the abort point and the rollback limits first.
6. **Watch the evidence afterwards** and report only what it shows. When the
   collision repair let the fly out of a building, that was reported as the repaired
   physics, not as navigation or learning.
7. **Keep the source release buildable,** forever.

Not every change needs a continuation. A release that changes no engine version
(the observer fix of 2026-11-02, or the store change of 2026-11-05 that made
commits stop slowing with age) is an ordinary upgrade: it must still resume the
store's head before `install.sh` switches to it, and it still needs approval.

## Open maintenance items

As of 2026-11-05, from the records:

- **Two credentials expire on 2027-10-30:** the VM's off-site write request
  `bethesda-life-backup-write` at 11:30 UTC, and the replay workflow's read request
  `bethesda-life-backup-read-2` (the `LIVE_FLY_BACKUP_READ_URL` secret) at 14:00 UTC.
  Make new ones before then ([off-site copies](BETHESDA_CONTINUOUS_LIFE.md#off-site-copies)).
- **The store change of 2026-11-05 is not deployed.** Until an approved upgrade
  carries it, each commit on the VM re-reads every older header, a cost that grows
  by 288 files a simulated day ([measurement](research/life-store/README.md)).
- **The watcher can be hours late.** GitHub ran its 15-minute schedule about every
  5 hours from 2026-10-31 to 2026-11-02. No outside monitor of `/v1/health` exists.
- **An Always Free VM can be reclaimed** if Oracle deems it idle. The off-site copies
  are what survives that.
- **A backup's check needs 3.4 GB beside the life,** and grows with the head.
- **Replay coverage is partial:** nothing before #1,990 has been re-derived, and no
  replay passed between #1,993 and #2,566.
- **A continuation candidate is waiting:** the [experiential habit](ECHO_EXPERIENTIAL_CONTINUATION.md)
  is implemented and not deployed. It needs the full procedure above.

## Eva is not kept here

Eva (`life_id` `5cf42cd6-fd0a-474d-882c-4cb70e0357e8`, born 2026-10-25 06:06:40
UTC by its `born_at`) is the garden's fly, simulated by a separate Python service on
its own VM. Its controller, learning and database are not in this repository and
have not been inspected from it. This repository holds only the clay exhibit that
reads `GET /api/state` ([live garden](LIVE_GARDEN.md)). Its continuity needs its own
procedure, kept by whoever operates the garden; nothing here may be done to it.
