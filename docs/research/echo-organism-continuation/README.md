# Rehearsal and cutover of the organism continuation

The evidence behind the rehearsal in
[the continuation's report](../../ECHO_ORGANISM_CONTINUATION.md#rehearsal-on-the-deployed-individuals-backup),
and behind [its cutover](../../ECHO_ORGANISM_CONTINUATION.md#the-cutover-as-it-ran):
what ran, on what, and what each file is. The rehearsal changed nothing of
the deployed individual's service, store or checkpoints, and nothing it ran
forward is the fly's life; [the cutover](#the-cutover), with its owner's
approval, is what changed them.

## What it ran on

- **The deployed individual's backup**
  `bethesda-life-20261027T121504Z-3db627bc1254.tar.gz`, the final one before
  the v3 continuation: 270 checkpoints, head 269 at tick 794,842. Unpacked
  read-only and checked against its SHA-256 manifest before and after.
- **A read-only copy of the live store**, streamed from the VM at 23:55 UTC
  on October 27 (410 checkpoints, head 409 at tick 1,211,849), for the
  checks in [`live-copy.txt`](live-copy.txt). Unpacked read-only, unchanged
  afterwards, then deleted.
- **The two releases the VM keeps**, rebuilt from git: `3db627b` (ECHO v2,
  which wrote the backup) and `d25e1f3` (ECHO v3, deployed until the
  cutover), each as the files the runner imports plus its `RELEASE` file.
- **This branch's working tree.**
- **Windows 11 on ARM64, Node 24.19.0.** The VM runs Linux arm64 and Node
  24.22.1, whose numerics differ
  ([cross-platform replay](../echo-replay/README.md)): whatever ran forward
  here is a disposable continuation on this machine, never the fly's.

The rehearsal made no store, took no lease and started no writer for the
deployed individual. Its checkpoints of that individual (64 to 66 MB each)
were written to a scratch directory, used by the next phase and deleted;
they are not kept here, because a copy of the fly is never a second instance
of it.

## Files

| File                                 | What it is                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `rehearse.ts`                        | The rehearsal, one phase per run (`verify`, `source`, `v3`, `organism`, `restart`, `deplete`, `smell`); its header says what each does       |
| `report-<phase>.json`                | Each phase's output, as written                                                                                                              |
| `report-smell*.json`                 | The placed copy, as found and with its reserve set to 30%, at six placements, each also run on ECHO v3 without the organism as a control     |
| `pairs.mjs`, `pairs.txt`             | The six placements at 30%, organism beside control, and their totals                                                                         |
| `long.ts`, `report-long.json`        | Increasingly long runs of an organism on the small test city (not the deployed individual), each run ending in a checkpoint restored exactly |
| `make-v3-store.ts`, `rollback.sh`    | The rollback rehearsal: a synthetic store with the deployed lineage, resumed by this release and by the real `d25e1f3` runner                |
| `rollback.txt`                       | `rollback.sh`'s output                                                                                                                       |
| `sizes.mjs`, `sizes-*.json`          | Where a checkpoint's bytes are, by path: checkpoints 266 and 269 of the backup, and the rehearsal's 272 and 277                              |
| `live-copy.txt`                      | The live store's copy: compared with the backup, the headers of checkpoints 269, 270 and 409, and both engines' `--check` on it              |
| `headers.mjs`, `compare-headers.mjs` | A checkpoint's header; the backup's checkpoints 265–269 against the copy's, everything but the graph                                         |
| `cutover.txt`                        | The [cutover](#the-cutover)'s outputs in order: each step's log, the journal at the stop and start, the leases and the readings after it     |
| `vm-organism-check.sh`               | Cutover step 3: checkpoint 270's header, then the `--check` on a read-only copy of a fresh backup, beside the service                        |
| `compare-step3.mjs`                  | Step 3's `--check` held against step 2's backup check: the individual, genesis, head, tick, kept graph, both checks                          |
| `*.js`                               | A store record's header and events by kind, its events, the fly's command counts, and the self-model's conclusion counts                     |

`headers.mjs` and `compare-headers.mjs` take their paths as arguments and
are as they ran. So are the cutover's scripts: `vm-organism-check.sh` and
`compare-step3.mjs` take theirs as arguments, and the four readers read
their own source from standard input (`node - FILE... < reader.js`), so
they ran on the VM's Node against the live store's files without a checkout
there. The other scripts here differ from the files that ran only in where
they find things: their path constants now come from `REHEARSAL_REPO` (this
repository) and `REHEARSAL_SCRATCH` (a directory holding the unpacked backup
in `backup-v2-121504Z/`, the release trees in `releases/<commit>/` and the
outputs in `rehearsal/out/`). `rehearse.ts`'s usage comment also lists every
phase. The outputs are as written, except that `rollback.txt` shows the
scratch directory as `<scratch>`.

## The cutover

It ran on the VM (Linux arm64, Node 24.22.1) on October 28, 2026, step by
step as [the plan](../../ECHO_ORGANISM_CONTINUATION.md#cutover-plan) says,
each step that changed the VM with its owner's approval:
[what happened](../../ECHO_ORGANISM_CONTINUATION.md#the-cutover-as-it-ran).
[`cutover.txt`](cutover.txt) holds what each step wrote, as written and in
order; each reader's output says whether it read the live store on the VM
or the step-9 backup on this laptop. The backups themselves are kept off the
VM, not here.

## Running it again

From this repository, with Node 24 and its dependencies installed, and each
release tree holding that commit's `package.json`, `package-lock.json`,
`scripts/run-ts.mjs`, `scripts/ts-hooks.mjs`, `scripts/bethesda-life-headless.ts`
and `src/`, its `node_modules` and a `RELEASE` file reading `commit <sha>`:

```sh
export REHEARSAL_REPO=$PWD REHEARSAL_SCRATCH=/path/to/scratch
R=docs/research/echo-organism-continuation
for phase in verify source v3 organism restart deplete smell; do
  node --max-old-space-size=3072 scripts/run-ts.mjs $R/rehearse.ts $phase
done
SMELL_KIND=v3 node --max-old-space-size=3072 scripts/run-ts.mjs $R/rehearse.ts smell
# The first placement is the default one; the others are named by SMELL_PLACEMENT.
for kind in organism v3; do
  export SMELL_KIND=$kind SMELL_RESERVE=0.3 SMELL_TICKS=18000
  node --max-old-space-size=3072 scripts/run-ts.mjs $R/rehearse.ts smell
  for n in 1 2 3 4 5; do
    SMELL_PLACEMENT=$n node --max-old-space-size=3072 scripts/run-ts.mjs $R/rehearse.ts smell
  done
done
unset SMELL_KIND SMELL_RESERVE SMELL_TICKS
node $R/pairs.mjs "$REHEARSAL_SCRATCH/rehearsal/out"
node --max-old-space-size=2048 scripts/run-ts.mjs $R/long.ts
bash $R/rollback.sh
```

Each phase reads what the one before wrote. On another platform the forward
runs differ from these reports; the checks that compare a fly with itself
(identity, integrity, preserved learning, exact restore, same-engine
continuation) do not depend on the platform.
