# The live fly's ledger

Each line of `ledger.jsonl` is a checkpoint of the deployed Bethesda
individual that a backup verified, appended by the repository's
"Live fly watch" workflow when it first saw it. Every checkpoint names its
parent's digest, so each line fixes the individual's whole history up to
that checkpoint. GitHub's record of when each line arrived is the witness;
the machine's own clocks are not.

This branch is append-only: nothing is edited, removed or force-pushed.
It holds no code, and `vercel.json` stops deployments of it.

To check an archive against every line, from the main branch:

```sh
tar -xzf bethesda-life-<UTC>-<commit>.tar.gz -C /tmp/check
node scripts/run-ts.mjs scripts/bethesda-life-ledger.ts verify \
  --store /tmp/check/store --ledger ledger.jsonl
```

See docs/BETHESDA_CONTINUOUS_LIFE.md ("The ledger") on the main branch.
