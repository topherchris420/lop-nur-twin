# Original ECHO individual: migration plan

**No rollout has occurred.** The original fly remains on its existing live
release. The new evaluation CLI accepts no production store path.
User approval is required before any stop, deployment, merge, or live state
change. A live upgrade using the current service architecture necessarily
pauses computation; it cannot satisfy an uninterrupted-computation promise.
An approved pause must be recorded, and no uncomputed experience attributed
to it. Do not attempt an unapproved hot swap or a second live writer.

## Reviewable stages

1. Review the audit, physiology model, limitations, tests and generated
   research report. Keep locomotion and open-ended-learning claims blocked
   while their independent gates remain unmet.
2. Build a release beside the running service. Verify its exact source
   commit, dependencies, tests, headless startup and memory/CPU envelope.
   This change does not edit `install.sh`, the systemd units, or their
   selection of `bethesdaStoreKind`.
3. With read-only access to a verified backup, restore it under its exact
   source release. Validate its chain, birth, immutable genesis, head graph,
   checkpoint digest, clock, controller, ECHO history and random streams.
   Do not use an observer JSON summary as a recovery checkpoint.
4. Run `prepareMaintenanceContinuation` on that backup in an isolated
   verification process. The function is pure with respect to storage.
   Check the exact original graph digest, unchanged tick, same birth and
   parent, valid real pause metadata, and an exact restore of the candidate.
   Step candidate/restored candidate beside each other; compare full hashes,
   command validity, recovery dynamics and resource use. Existing tests cover
   synthetic research sources; **the original's actual backup has not been
   obtained or dry-run in this task**.
5. Rehearse backup restoration and rollback in a separate environment. A
   research twin gets its own identity. Never run a copied store as a second
   authoritative continuation of the original, and never merge its history.
6. Implement and review a version-selector/runner addition that recognizes
   the exact maintenance continuation and delegates its `LifeKind.step`.
   The current production runner calls the headless clock directly, so just
   adding a schema selector is insufficient. Recovery-enter/exit and
   maintenance-supply audit events need a production archival path as well.
   This integration is deliberately absent until the backup rehearsal and
   operational approval. Do not manually append a candidate and expect the
   existing runner to maintain it.
7. Present the verified original-specific dry-run report, recoverable backup,
   exact release, estimated pause, rollback procedure and operational risks
   for **explicit approval**. Approval applies to this concrete maintenance-only
   cutover, not automatically to the experimental MB/ECHO composition.

## Approved cutover procedure, still pending

- Record the actual observer ID and final deployment version. Stop the
  single authoritative service only after approval. Let its normal shutdown
  write its final checkpoint and release the lease. Record the real stopped
  time; require that the process is gone before another writer can start.
- Create a verified, recoverable backup of that **final** stopped store,
  outside the working store; retain source release, hashes, ownership and
  permissions. Preserve all originals. The earlier rehearsal backup may be
  stale and is not an acceptable parent for a live append.
- Revalidate the final chain under its exact old release. Rerun the pure
  candidate preparation with the actual pause times. Require the same
  individual ID, birth nonce, genesis, exact parent digest and unchanged tick.
  Verify restore and future deterministic replay before publishing anything.
- Acquire the existing epoch-fenced lease using the reviewed new runner and
  publish exactly one linked transition through `LifeStore.commit`. Do not
  edit checkpoint files, fabricate sequences, delete corrupt heads, bypass
  seals, or use `--create`. Confirm the new runner advances this kind's
  maintenance step and commits under the new version.
- Resume one service and verify the identity, monotonic tick, recorded pause,
  checkpoint health, tissue state, metered energy and absence of command
  rejection. Verify a fresh backup and a restart under the new release.
  The observer remains read-only. Keep all old releases and backups.

## Rollback boundaries

Before committing the migration, the final verified old store can be resumed
under its own release without a state conversion. That is the straightforward
rollback and is part of the rehearsal.

After a migration is committed, a blind downgrade is refused. After new ticks
are committed, restoring the earlier backup discards history and can create a
branch; it must never be reported as uninterrupted continuity. Prefer a new,
explicit repair continuation that preserves the current history. If backup
recovery is unavoidable, keep the failed store, stop every other writer,
record the lost interval and parentage, and obtain approval for that specific
recovery. The present migration is additive but does not promise a reversible
projection of experiences computed under a different engine.

## Further biological integration

The maintenance-only path preserves the original adapter exactly. Migrating
it to the new research composition is a different operation: the old
controller, navigation and ECHO state would have to be transplanted with a
byte-verified reverse projection, the new MB state explicitly introduced at
the migration boundary, and both code releases retained for replay.
There is no such original-specific neural migration in this change. Do not
replace the original adapter with a freshly initialized research adapter.
