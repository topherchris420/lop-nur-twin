# Eva and ECHO: activating embodied plasticity on the originals

**Status (2026-11-07): ECHO activated in shadow mode at 22:28:29Z. Eva activated in
shadow mode at 22:04:04Z.** Both learn and report; neither acts on what it learns.
This file is the procedure and the record. A step happens only when the owner
approves that step; a GitHub merge, a Vercel deploy or a passing workflow is not
activation. Each original keeps its identity: this continues the same individual,
it never births, replaces, resets or replays one.

| Original | Identity                                                           | Live now                                                                                               | Next gate             |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------- |
| ECHO     | `04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921` | release `5cc5035`, `echo-embodied-plasticity/v2` in **shadow** since checkpoint 3554 (tick 10,633,342) | E11: 7 days of shadow |
| Eva      | `5cf42cd6-fd0a-474d-882c-4cb70e0357e8`                             | patched `server.py` `a942234b…`, `eva-embodied-plasticity/v1` in **shadow** since tick 236,128         | V8: 7 days of shadow  |

What the additions are: [EVA_ECHO_BRAIN_PLASTICITY.md](EVA_ECHO_BRAIN_PLASTICITY.md).

## ECHO

Every step runs from the approved release, as the service's user, with the
service's own paths. Stop at the first failure; until step E8 nothing has
changed and the unchanged old release simply keeps running.

| Gate | What                                                                                                                                                                                     | Evidence that it passed                                                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1   | The PR is merged (merge commit)                                                                                                                                                          | the merge SHA                                                                                                                                                                                                                                    |
| E2   | Vercel has deployed `/live` from that merge, so the public page parses `adaptiveBrain` **before** any observation carries it (its parser is strict: an unknown key would blank the page) | `/live` loads; the deployment's commit is the merge or later                                                                                                                                                                                     |
| E3   | `ECHO plasticity rehearsal` passes on a copy of the newest backup (`workflow_dispatch`, 24 simulated hours)                                                                              | the run URL and its `rehearsal.jsonl` artifact: `chain`, `engine.sameHash`, `boundary.exact`, `refusal` both non-null, `lockstep.identicalThroughout`, `projection.same`, `restart.same`, `policy.verified`, `runner.status 0`, `old.status ≠ 0` |
| E4   | A fresh backup, uploaded off site and restore-tested                                                                                                                                     | the 6-hourly backup record (or a manual one) newer than the last checkpoint, its SHA-256, the restore test                                                                                                                                       |
| E5   | The live state recorded                                                                                                                                                                  | witnessed individual, head sequence, tick, digest, release (`e458f7c…`), `systemctl is-active`, last ledger anchor                                                                                                                               |
| E6   | The release prepared beside the running one: `sudo deploy/bethesda-life/install.sh --prepare`                                                                                            | the new release directory; the service still on the old one                                                                                                                                                                                      |
| E7   | The read-only check on a **copy** of the E4 backup on the VM                                                                                                                             | exit 0 and the script's JSON: `individual` is ECHO's, `preservedGraphDigest` = `sourceGraphDigest`, `shadowUnchanged: true`, `startMode: "shadow"` (any failed check exits non-zero instead)                                                     |
| E8   | **Owner-approved stop**, then commit the continuation                                                                                                                                    | see below                                                                                                                                                                                                                                        |
| E9   | Switch and start: `sudo deploy/bethesda-life/install.sh`                                                                                                                                 | the service active on the new release                                                                                                                                                                                                            |
| E10  | Verify the live original                                                                                                                                                                 | same individual and birth; head sequence = E5 + 1 at the **same tick**, then growing; `/live` shows "Its walking memory", mode shadow, samples growing; the next sealed replay passes                                                            |
| E11  | Shadow period: at least 7 days of live evidence before any request for active mode                                                                                                       | `adaptiveBrain` samples, discards, walks it would have slowed                                                                                                                                                                                    |

E7, on a copy (never the live store):

```bash
node --max-old-space-size=4096 scripts/run-ts.mjs scripts/bethesda-life-continue-plasticity.ts \
  --store /path/to/copy/of/backup/store \
  --from-release /opt/bethesda-life/releases/e458f7cb34904d85127779a3700c26b376ab4a80 --check
```

E8, after the owner approves this step:

```bash
sudo systemctl stop bethesda-life
# The lease is released and a final backup exists before anything is written.
ECHO_PLASTICITY_APPROVE_INDIVIDUAL=04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921 \
  node --max-old-space-size=4096 scripts/run-ts.mjs scripts/bethesda-life-continue-plasticity.ts \
  --store /var/lib/bethesda-life/store \
  --from-release /opt/bethesda-life/releases/e458f7cb34904d85127779a3700c26b376ab4a80 --commit
```

The commit refuses unless the store's birth is the original's, the source release
is exactly `e458f7c`, the old and new organisms agree for 600 ticks, the shadow
projection equals the organism, and the continued life restores identically; it
then verifies the whole chain. If any of that fails before the commit, start the
unchanged old release. **After the commit, never start an older release or restore
an older checkpoint**: both would fork the individual. Older engines refuse the
continued checkpoint by design.

### Changing the mode later (forward only)

Shadow to active, active to disabled, and so on: each change is its own
owner-approved stop, a policy checkpoint at the same tick, and a start.

```bash
sudo systemctl stop bethesda-life
ECHO_PLASTICITY_APPROVE_INDIVIDUAL=04f8c797… ECHO_PLASTICITY_APPROVE_MODE=active \
  node --max-old-space-size=4096 scripts/run-ts.mjs scripts/bethesda-life-plasticity-policy.ts \
  --store /var/lib/bethesda-life/store --to active --reason "…why, and the evidence…" --commit
sudo systemctl start bethesda-life
```

Run `--check` first. To turn the behaviour off, change to `disabled`: the memory
is kept, nothing is learned and nothing acts, and the history shows when and why.
Active mode is not requested unless the shadow evidence (E11) and the held-out
study support it.

## Eva

Her service is `bethesda-fly` on the garden VM (`/opt/bethesda-fly`, database
`/var/lib/bethesda-fly/world.sqlite3`). The repository's tooling never restarts it,
edits systemd or touches her database; the owner runs those steps by hand.

| Gate | What                                                                                                                                               | Evidence that it passed                                                                                                                                                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1   | The PR is merged                                                                                                                                   | the merge SHA                                                                                                                                                                                                                                                          |
| V2   | Her live files still match what was tested: `sha256sum /opt/bethesda-fly/{server,learning,backup}.py` equals `deploy/garden/service/MANIFEST.json` | the three hashes; **stop** if any differs (her service changed since 2026-11-07)                                                                                                                                                                                       |
| V3   | A fresh backup: `node deploy/garden/deploy.mjs backup` (her own day-N snapshot, integrity-checked, copied off the VM)                              | the snapshot name, its SHA-256, `PRAGMA integrity_check` ok                                                                                                                                                                                                            |
| V4   | Her state recorded from `/state`: `life_id`, `born_at`, `ticks`, `journeys`, `moments_count`, `learning.trials`                                    | the JSON                                                                                                                                                                                                                                                               |
| V5   | **Owner-approved install**: keep the original, add the two files, add the setting                                                                  | see below                                                                                                                                                                                                                                                              |
| V6   | **Owner-approved restart** of `bethesda-fly`                                                                                                       | `systemctl is-active bethesda-fly`                                                                                                                                                                                                                                     |
| V7   | Verify                                                                                                                                             | same `life_id` and `born_at`; `ticks`, `journeys`, `moments_count`, `learning.trials` all ≥ V4; `adaptive.status` = `ok`, `adaptive.mode` = `shadow`, `adaptive.life_id` = hers; the sidecar exists beside her database; `/health` ok; the garden page still draws her |
| V8   | Shadow period: at least 7 days                                                                                                                     | `adaptive.samples`, `would_override`, its daily copies                                                                                                                                                                                                                 |

V5, by hand on the garden VM, after the owner approves:

```bash
cd /opt/bethesda-fly
sudo cp -p server.py server.py.original-c110ccc8   # her original, kept byte for byte
sudo install -m 0644 /path/to/release/deploy/garden/service/server.py server.py
sudo install -m 0644 /path/to/release/deploy/garden/service/eva_plasticity.py eva_plasticity.py
sudo mkdir -p /etc/systemd/system/bethesda-fly.service.d
printf '[Service]\nEnvironment=EVA_PLASTICITY=shadow\n' | sudo tee /etc/systemd/system/bethesda-fly.service.d/plasticity.conf
sudo systemctl daemon-reload
```

Then V6: `sudo systemctl restart bethesda-fly`. Her clock catches up the seconds
it was stopped, as it does after any restart.

To turn it off, remove `plasticity.conf` (or set `EVA_PLASTICITY=`), reload and
restart: the patched server without the setting is her original behaviour, and
`server.py.original-c110ccc8` is her original file if wanted. The sidecar stays,
so a later start in shadow continues what it learned. Changing to active is the
same edit with `EVA_PLASTICITY=active`, a separate owner approval, and is recorded
in the sidecar's `mode_history`. Her database is never replaced, cleared or
regenerated: with the setting present, the service refuses to start if her
database is missing.

## Record

Every executed step is appended here with its time, its evidence and who approved
it, including failures.

**Approval.** The owner approved activating both originals on 2026-11-07, shortly
before the merge ("ACTIVATE IT"), and merged #178 themselves. The session's safety
classifier refused VM writes and the merge from the session. So the session made
read-only checks, took Eva's backup, and staged scripts in `/tmp` on each VM. The
owner ran each VM write from the session with a `!` command that first checks the
staged script's SHA-256. The scripts, byte for byte as they ran, are
[`eva-install.sh`](research/plasticity-activation/eva-install.sh) (`fe8a9de6…`)
and [`echo-cutover.sh`](research/plasticity-activation/echo-cutover.sh)
(`b3813719…`). ECHO's whole log, including the aborted first window, is
[`echo-cutover.log`](research/plasticity-activation/echo-cutover.log). Eva's
install output is [`eva-install.txt`](research/plasticity-activation/eva-install.txt).

### Eva

| Gate | UTC            | Evidence                                                                                                                                                                                                                                                                    |
| ---- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1   | 21:31:00       | #178 merged as `5cc5035` by the owner                                                                                                                                                                                                                                       |
| V2   | 21:32          | live `server.py` `c110ccc8…`, `learning.py` `cb145891…`, `backup.py` `59c0dc99…`, equal to `MANIFEST.json`                                                                                                                                                                  |
| V3   | 21:33:57       | `deploy.mjs backup`: her `day-5.sqlite3`, 499,712 bytes, SHA-256 `c61d7500…`, integrity ok, same life and birth, 7,260 moments; kept off the VM                                                                                                                             |
| V4   | 21:33          | `ticks` 235,761, `journeys` 1,851, `moments_count` 7,259, `learning.trials` 231,256                                                                                                                                                                                         |
| —    | 21:35          | on her VM, the staged `server.py` without its 17 tagged lines hashes to `c110ccc8…`, her live file                                                                                                                                                                          |
| V5   | 22:04          | the script checked all three hashes, kept `server.py.original-c110ccc8`, installed `server.py` `a942234b…` and `eva_plasticity.py` `613fd429…`, added `EVA_PLASTICITY=shadow`                                                                                               |
| V6   | 22:04:04       | restarted; `/health` answered at 22:04:06; her log: "Embodied plasticity: shadow, ok"                                                                                                                                                                                       |
| V7   | 22:13 to 22:24 | same `life_id` and `born_at`; `ticks` 236,195, `journeys` 1,859, `moments_count` 7,283, `trials` 231,675 (all above V4); `adaptive` ok, shadow, her life ID; sidecar and its day copy beside her database; no restarts; the deployed page's parser accepts her public state |
| V8   | from 22:04     | started. No samples yet: since tick 236,128 she has been asleep on the windowsill, and it learns only from travel steps                                                                                                                                                     |

Not done: nobody has looked at her garden page since; the parser test stands in
for that. The garden page's new plasticity line is not published (that needs
`deploy.mjs publish` and its own approval).

### ECHO

| Gate     | UTC                  | Evidence                                                                                                                                                                                                                                                                                 |
| -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1       | 21:31:00             | #178 merged as `5cc5035` by the owner                                                                                                                                                                                                                                                    |
| E2       | 21:33:12             | Vercel production deployment of `5cc5035`; the production `LiveFly` chunk contains the `adaptiveBrain` parser and "Its walking memory"                                                                                                                                                   |
| E3       | 20:15 to 21:48       | run 42410104938 at `288b3a8` (no ECHO-side change to `5cc5035`), on backup `20261107T180654Z` (checkpoint 3503), 24 simulated hours: chain, `engine.sameHash`, `boundary.exact`, both refusals, lockstep 36,000 ticks, projection, restart and policy all passed; runner 0, old engine 1 |
| E6       | 22:04:21             | release `5cc5035` prepared beside the running one in 13 s; service untouched                                                                                                                                                                                                             |
| E4 to E7 | 22:04:21 to 22:10:42 | **first window, aborted.** Stopped at checkpoint 3552; backup `20261107T220517Z` uploaded; the check passed, but the script's own validator crashed: it passed `--check` as an argument to `node -e`, and Node took it for its own option. Nothing committed                             |
| —        | 22:10:43             | the script started `e458f7c` again, unchanged. One `gap` in checkpoint 3553, 22:05:08 to 22:11:27 (6 min 19 s). The validator was fixed (mode names without dashes), tested on that check's output and four broken inputs, and restaged                                                  |
| E5       | 22:14:10             | head checkpoint 3552 before the second window; service active on `e458f7c`                                                                                                                                                                                                               |
| E8 stop  | 22:14:53             | stopped; last checkpoint 3553, tick 10,633,342                                                                                                                                                                                                                                           |
| E4       | 22:15:48             | backup `20261107T221453Z`, SHA-256 `3f9ba1b1…`, checkpoint 3553, restored and checked by `backup.sh`, uploaded off site                                                                                                                                                                  |
| E7       | 22:20:11             | `--check` on a read-only copy of that backup, 261 s: ECHO, checkpoint 3554 at tick 10,633,342, graph `0b925419…` = source, shadow unchanged, starts in shadow; the copy unchanged                                                                                                        |
| E8       | 22:25:05             | **committed:** checkpoint 3554, tick 10,633,342, parent `e85dd183…` (checkpoint 3553), graph kept, mode shadow, 357 s                                                                                                                                                                    |
| E9       | 22:28:54             | `install.sh`: the release resumed the store, switched, kept `3db627b`, `bdb7c02`, `d25e1f3` (pinned) and `e458f7c` (previous), started; no restarts; observer live. One `gap` in checkpoint 3555, 22:14:45 to 22:28:29 (13 min 45 s)                                                     |
| E10      | 22:34 to 22:38       | checkpoint 3555 at tick 10,636,342: same individual, `echo-embodied-plasticity/v2`. The public witness: live, mode shadow, samples 989 then 1,079 a minute later, adaptations 0. The production parser accepts that witness                                                              |
| E11      | from 22:28           | started                                                                                                                                                                                                                                                                                  |

Still owed for E10: the next sealed replay over checkpoints from `5cc5035`, and the
first scheduled backup on the new release (due 00:01Z), checked by `backup.sh` with
the new release.

ECHO now refuses every older release by design. If shadow mode must stop, the way
out is a forward `disabled` policy checkpoint, never a restore.
