#!/usr/bin/env bash
# Rollback rehearsal on a synthetic store with the deployed lineage (never the
# deployed individual): the release upgrade and the --check are undone by the
# deployed v3 release resuming the store; after --commit that release refuses
# it, failing closed and changing nothing.
set -u
SCRATCH=$REHEARSAL_SCRATCH
NEW=$REHEARSAL_REPO
OLD=$SCRATCH/releases/d25e1f3b9e40c5ded3f8ce1f435365d5c6c80592
D=$SCRATCH/rehearsal/rollback-store
rm -rf "$D"
step() { printf '\n== %s\n' "$*"; }
new() { (cd "$NEW" && node scripts/run-ts.mjs "$@"); }
old() { (cd "$OLD" && node scripts/run-ts.mjs "$@"); }
files() { (cd "$D" && find . -type f | sort | xargs sha256sum | sha256sum | cut -c1-16); }
last() { tail -n 1 | cut -c1-400; }

step "a synthetic store with the deployed lineage"
new "$NEW/docs/research/echo-organism-continuation/make-v3-store.ts" "$D" | last
step "this release's runner continues the v3 fly (the release upgrade, no continuation yet)"
new scripts/bethesda-life-headless.ts --store "$D" --ticks 300 2>/dev/null | last; echo "exit ${PIPESTATUS[0]}"
step "rollback of the release: the deployed d25e1f3 runner resumes what this release committed"
old scripts/bethesda-life-headless.ts --store "$D" --ticks 100 2>/dev/null | last; echo "exit ${PIPESTATUS[0]}"
new scripts/bethesda-life-headless.ts --store "$D" --ticks 100 2>/dev/null | last; echo "exit ${PIPESTATUS[0]}"
step "the continuation's --check changes no file"
before=$(files)
new scripts/bethesda-life-continue-organism.ts --store "$D" --from-release "$OLD" --check 2>/dev/null | last; echo "exit ${PIPESTATUS[0]}"
after=$(files)
echo "store files before $before after $after same=$([ "$before" = "$after" ] && echo yes || echo NO)"
step "after --check the deployed release still resumes the store"
old scripts/bethesda-life-headless.ts --store "$D" --ticks 100 2>/dev/null | last; echo "exit ${PIPESTATUS[0]}"
step "--commit"
new scripts/bethesda-life-continue-organism.ts --store "$D" --from-release "$OLD" --commit 2>/dev/null | last; echo "exit ${PIPESTATUS[0]}"
step "after --commit the deployed release refuses the store, failing closed and changing nothing"
before=$(files)
old scripts/bethesda-life-headless.ts --store "$D" --ticks 10 2>&1 >/dev/null | grep -v '^    at ' | head -3; echo "exit ${PIPESTATUS[0]}"
after=$(files)
echo "store files before $before after $after same=$([ "$before" = "$after" ] && echo yes || echo NO)"
step "this release lives on as the organism, and verifies the whole chain"
new scripts/bethesda-life-headless.ts --store "$D" --ticks 300 2>/dev/null | last; echo "exit ${PIPESTATUS[0]}"
new scripts/bethesda-life-headless.ts --store "$D" --verify 2>/dev/null | last; echo "exit ${PIPESTATUS[0]}"
step "a second continuation is refused"
new scripts/bethesda-life-continue-organism.ts --store "$D" --from-release "$OLD" --check 2>&1 >/dev/null | grep -v '^    at ' | head -2; echo "exit ${PIPESTATUS[0]}"
rm -rf "$D"
