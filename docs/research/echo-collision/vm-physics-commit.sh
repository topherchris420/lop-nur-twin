#!/usr/bin/env bash
# Cutover step 6 (docs/ECHO_COLLISION.md#cutover-plan), as root on the VM, with the
# service stopped: the physics continuation's --commit on the live store. It repeats
# every --check step, takes the lease only after all of them pass, refuses if the head
# changed, and publishes one checkpoint through LifeStore. After it, the deployed
# release refuses this store: step 7 runs straight after.
#
# It runs as its own transient unit, so a dropped SSH connection cannot stop it halfway,
# and it keeps its output on disk. It holds the lock backup.sh and install.sh take.
#
#   sudo bash vm-physics-commit.sh /opt/bethesda-life/releases/COMMIT
set -euo pipefail

SERVICE=bethesda-life
NODE=/opt/bethesda-life/node/bin/node
STORE=/var/lib/bethesda-life/store
SOURCE_RELEASE=/opt/bethesda-life/releases/bdb7c02a5cf0b9040be81e0435ae49c8ec9e90b1
INDIVIDUAL=04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921

die() {
  printf 'vm-physics-commit.sh: %s\n' "$*" >&2
  exit 1
}
[ $# -eq 1 ] || die "usage: vm-physics-commit.sh RELEASE_DIR"
release=$1
[ "$(id -u)" -eq 0 ] || die "run it as root (sudo)"
[ -f "$release/scripts/bethesda-life-continue-physics.ts" ] || die "$release has no continuation script"
[ -f "$SOURCE_RELEASE/RELEASE" ] || die "missing $SOURCE_RELEASE"
exec 9>/run/bethesda-life-backup.lock
flock -n 9 || die "a backup or an install is at work: nothing was changed"

state=$(systemctl is-active "$SERVICE" || true)
pid=$(systemctl show -p MainPID --value "$SERVICE")
echo "service: $state, pid $pid"
[ "$state" != active ] && [ "$state" != activating ] && [ "$state" != deactivating ] && [ "$pid" -eq 0 ] ||
  die "the service is not stopped: nothing was changed"

head_file=$(find "$STORE/checkpoints" -name '*.json' | sort | tail -n 1)
echo "head before: $(basename "$head_file")"

out=$(mktemp -d /var/tmp/physics-commit.XXXXXX)
echo "output: $out"
echo "commit start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
set +e
systemd-run --wait --collect --quiet --unit="$SERVICE-physics-commit" \
  -p User="$SERVICE" -p Group="$SERVICE" -p WorkingDirectory="$release" \
  -p StandardOutput="file:$out/commit.out" -p StandardError="file:$out/commit.err" \
  "$NODE" --max-old-space-size=4096 scripts/run-ts.mjs scripts/bethesda-life-continue-physics.ts \
  --store "$STORE" --from-release "$SOURCE_RELEASE" --commit
status=$?
set -e
echo "commit end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "status: $status"
cat "$out/commit.err" "$out/commit.out"
new_head=$(find "$STORE/checkpoints" -name '*.json' | sort | tail -n 1)
echo "head now: $(basename "$new_head")"
[ "$status" -eq 0 ] || die "the commit refused or failed: read the output above before doing anything else"

"$NODE" --max-old-space-size=1024 -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").at(-1));
  const fail = (m) => { console.error("vm-physics-commit.sh: " + m); process.exit(1); };
  if (r.mode !== "--commit") fail("that was not a commit");
  if (r.individual !== process.argv[2]) fail("that was not the deployed individual");
  if (r.sequence !== r.previousSequence + 1) fail("the new checkpoint does not follow the head");
  if (r.preservedGraphDigest !== r.sourceGraphDigest) fail("the graph was not preserved");
  if (r.versions.fly !== "digital-fly/9") fail("the new checkpoint is not on digital-fly/9");
  console.log("continuation: checkpoint " + r.sequence + " at tick " + r.tick + ", parent " + r.parent);
  console.log("graph kept: " + r.preservedGraphDigest);
' "$out/commit.out" "$INDIVIDUAL"
