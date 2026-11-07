# Eva and ECHO: activating embodied plasticity on the originals

**Status (2026-11-07): ECHO not activated. Eva not activated.** This file is the
procedure and the record. A step happens only when the owner approves that step;
a GitHub merge, a Vercel deploy or a passing workflow is not activation. Each
original keeps its identity: this continues the same individual, it never births,
replaces, resets or replays one.

| Original | Identity                                                           | Live now                                                     | Next gate |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------ | --------- |
| ECHO     | `04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921` | organism on release `e458f7c` (digital-fly/9), no plasticity | E1: merge |
| Eva      | `5cf42cd6-fd0a-474d-882c-4cb70e0357e8`                             | original `server.py` `c110ccc8…`, no plasticity              | V1: merge |

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
it, including failures. Nothing has been executed yet.
