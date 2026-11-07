# Original Eva and ECHO brain activation: gated operator record

**Status: code prepared; neither original has been activated by this branch.**
This is a proposed continuation of the originals, never a new birth. Nothing in a
GitHub merge or website deployment has authority to change the two Oracle VMs.

## ECHO: new brain on its existing organism

The original ECHO individual is `04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921`.
The `PlasticityOrganismLife` kind adds `EmbodiedPlasticity` from PR #176
**to the existing organism**, retaining its mushroom body, olfaction,
physiology, ECHO v3 model, navigation, sensory streams, and past checkpoints.
It begins with no new samples and makes cautious walking adjustments after
observed failures; flight, escape, landing, and motor validation remain the
original's. It is not a whole-brain connectome.

`continueWithPlasticity` only accepts an authentic previous organism
checkpoint, appends a zero-tick `plasticity-continuation` event, and checks
that the reverse projection equals the original graph digest byte for byte.
The new life kind's history refuses silent reversion or a second continuation.
`bethesdaStoreKind` selects the new kind **only after** the continuation
has actually been committed. Previous releases remain buildable to verify
their own eras.

### Before touching the live VM

1. Record the original's current witnessed ID, checkpoint, tick, engine
   versions, release SHA, service state and last off-site ledger anchor.
   Stop if the individual ID differs from the ID above.
2. Create and restore-test a complete **off-site and local backup** of
   `/var/lib/bethesda-life/store`. Verify its seals and witness consistency.
   Do not use an older backup to overwrite a later live head.
3. Build the proposed release on the target Linux arm64 machine using
   `sudo deploy/bethesda-life/install.sh --prepare`. This does not stop or
   switch the service.
4. On an **isolated copy** of the verified backup, with the **exact currently
   installed original release** at `OLD_RELEASE_DIR`, run the read-only
   preflight:

   ```bash
   node --max-old-space-size=4096 scripts/run-ts.mjs \
     scripts/bethesda-life-continue-plasticity.ts \
     --store /path/to/verified/disposable-copy \
     --from-release OLD_RELEASE_DIR --check
   ```

   It checks source restoration on its original engine, 600 forward ticks of
   old versus new unmodified organism logic, projected graph equality, and
   post-continuation deterministic restore/replay.

5. Require a separate, reviewable rehearsal of the exact stop/commit/start
   sequence on a disposable Linux arm64 VM. Run a preregistered held-out
   evaluation against baseline and shadow controllers for meal count, collisions,
   uncertainty and deterministic reproduction. **Do not commit** if either
   the proof or safety criteria fail.

### Authorized live continuation, only after all gates pass

Once the exact live store and latest backup have been reverified, the owner
explicitly authorizes the cutover and the operator records its pause interval:

```bash
sudo systemctl stop bethesda-life
# Verify that it stopped cleanly, its lease is released and a final backup exists.
ECHO_PLASTICITY_APPROVE_INDIVIDUAL=04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921 \
  node --max-old-space-size=4096 scripts/run-ts.mjs \
  scripts/bethesda-life-continue-plasticity.ts \
  --store /var/lib/bethesda-life/store \
  --from-release OLD_RELEASE_DIR --commit
sudo deploy/bethesda-life/install.sh
```

Run those only from the approved release and as an operator with correct
filesystem permissions. If a pre-commit check fails, restart the **unchanged**
old release without rewriting any checkpoint. **After commit, do not boot an
older incompatible engine or restore an older checkpoint**: use another sealed
forward continuation for any future reversal. Check the live witness, the
monotonic checkpoint/tick, the unchanged individual and genesis, the archived
brains, and independent replay. Record the outcome, including failures.

These are **instructions, not commands executed by this pull request**.

## Eva: read-only until her real Python service is available

Eva's identity is `5cf42cd6-fd0a-474d-882c-4cb70e0357e8`. Her
`server.py`, `learning.py` and authoritative SQLite/database are on a
**different Oracle VM and are not committed to this repository**. The Python
`EvaAdaptiveBrain` added in PR #176 is executable but is still an isolated
sidecar. It cannot be made authoritative by shipping a web page.

Before activation, obtain the operator-reviewed exact live server source,
verified and restore-tested database snapshot, current life ID/birth/time,
and existing backup/restart procedure. Exercise its sidecar **in shadow mode**
on real read-only observations, ensuring duplicate observations do not
double-count and identity mismatches fail closed. Add a versioned, optional
`learning.py` integration and test that the original database and action
guards remain authoritative. Only then turn on recommendations with a separately
audited deployment and a check that her ID, birth, tick and cumulative journeys
and trials never regress.

**Never issue an unaudited `--create`, clear a store, reset a learning table,
or substitute a research fly for either original.**
