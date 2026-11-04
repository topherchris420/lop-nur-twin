#!/usr/bin/env bash
# Cutover step 3 (docs/ECHO_COLLISION.md#cutover-plan), as root on the VM: the
# physics continuation's --check against an unpacked copy of a fresh backup. The
# copy is read-only to the service user and deleted afterwards. Nothing is
# committed, stopped or switched.
#
# Beside the running service it starts only if memory holds both at their peaks:
# the check's (3,879 MB measured on a copy of the backup, CHECK_MB allowed) and the
# service growing from its resident size back to its high-water mark. Otherwise it
# stops and changes nothing, and the commit's own identical checks are the first to
# run on this machine, in the window. All it starts is the kernel's first
# out-of-memory victim (the service has OOMScoreAdjust=500), and the check runs at the
# lowest CPU priority under a memory cap, so the service is never the one stopped.
#
#   sudo bash vm-physics-check.sh /var/backups/bethesda-life/NAME.tar.gz /opt/bethesda-life/releases/COMMIT
set -euo pipefail

SERVICE=bethesda-life
NODE=/opt/bethesda-life/node/bin/node
SOURCE_RELEASE=/opt/bethesda-life/releases/bdb7c02a5cf0b9040be81e0435ae49c8ec9e90b1
INDIVIDUAL=04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921
CHECK_MB=3900
MEMORY_MAX=4608M

die() {
  printf 'vm-physics-check.sh: %s\n' "$*" >&2
  exit 1
}
[ $# -eq 2 ] || die "usage: vm-physics-check.sh BACKUP.tar.gz RELEASE_DIR"
backup=$1
release=$2
[ "$(id -u)" -eq 0 ] || die "run it as root (sudo)"
for f in "$backup" "$release/RELEASE" "$release/scripts/bethesda-life-continue-physics.ts" "$SOURCE_RELEASE/RELEASE"; do
  [ -f "$f" ] || die "missing $f"
done
echo 1000 >/proc/self/oom_score_adj

mb() { awk -v key="$1:" '$1 == key { print int($2 / 1024) }' "$2"; }
service() {
  printf '%s, pid %s, restarts %s' "$(systemctl is-active "$SERVICE" || true)" \
    "$(systemctl show -p MainPID --value "$SERVICE")" "$(systemctl show -p NRestarts --value "$SERVICE")"
}

before=$(service)
pid=$(systemctl show -p MainPID --value "$SERVICE")
available=$(mb MemAvailable /proc/meminfo)
if [ "$pid" -gt 0 ]; then
  resident=$(mb VmRSS "/proc/$pid/status")
  high=$(mb VmHWM "/proc/$pid/status")
  need=$((CHECK_MB + high - resident + 512))
  echo "service: $before; resident $resident MB, high-water $high MB"
else
  need=$((CHECK_MB + 512))
  echo "service: $before"
fi
echo "memory: $available MB available, $need MB needed"
[ "$available" -ge "$need" ] || die "too little memory beside the service: skip this step; the commit runs the same checks in the window"

dir=$(mktemp -d "/var/lib/$SERVICE/physics-check.XXXXXX")
trap 'rm -rf "$dir"' EXIT
tar --extract --gzip --no-same-owner --file "$backup" --directory "$dir"
chown -R "root:$SERVICE" "$dir"
chmod -R u=rwX,g=rX,o= "$dir"
runuser -u "$SERVICE" -- test -r "$dir/store/individual.json" || die "$SERVICE cannot read the copy"
if runuser -u "$SERVICE" -- test -w "$dir/store/checkpoints"; then die "$SERVICE can write to the copy"; fi
manifest() { (cd "$dir/store" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-64); }
hashes=$(manifest)
echo "copy: $(find "$dir/store" -type f | wc -l) files, $(du -sm "$dir/store" | cut -f1) MB, read-only to $SERVICE"

head_file=$(find "$dir/store/checkpoints" -name '*.json' | sort | tail -n 1)
h=$("$NODE" --max-old-space-size=1024 -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).checkpoint;
  console.log(c.sequence, c.tick, c.birth.individual, c.versions.fly);
' "$head_file")
read -r sequence tick individual fly <<<"$h"
echo "head: checkpoint $sequence, tick $tick, individual $individual, $fly"
[ "$individual" = "$INDIVIDUAL" ] || die "this backup is not the deployed individual: the cutover stops here"
[ "$fly" = digital-fly/8 ] || die "this backup is not on digital-fly/8: the cutover stops here"

hook='data:text/javascript,process.on("exit",()=>process.stderr.write("peak-rss-kb "+process.resourceUsage().maxRSS+String.fromCharCode(10)))'
echo "check: release $(sed -n 's/^commit //p' "$release/RELEASE") from $SOURCE_RELEASE; heap 4096 MB, cap $MEMORY_MAX, nice 19"
start=$SECONDS
set +e
(cd "$release" && systemd-run --scope --quiet -p MemoryMax="$MEMORY_MAX" -p MemorySwapMax=0 \
  bash -c 'echo 1000 >/proc/self/oom_score_adj && exec "$@"' _ \
  nice -n 19 runuser -u "$SERVICE" -- "$NODE" --max-old-space-size=4096 --import="$hook" \
  scripts/run-ts.mjs scripts/bethesda-life-continue-physics.ts \
  --store "$dir/store" --from-release "$SOURCE_RELEASE" --check) </dev/null >"$dir/check.out" 2>"$dir/check.err"
status=$?
set -e
echo "check: exit $status in $((SECONDS - start)) s"
[ "$status" -ne 137 ] || echo "check: exit 137 is a kill, most likely for memory; see the service line below" >&2
cat "$dir/check.err" "$dir/check.out"

if [ "$(manifest)" = "$hashes" ]; then
  echo "copy: unchanged ($hashes)"
else
  echo "copy: CHANGED" >&2
  status=1
fi
after=$(service)
echo "service: $after; $(mb MemAvailable /proc/meminfo) MB available"
if [ "$after" != "$before" ]; then
  echo "service: CHANGED during this step (it was $before)" >&2
  status=1
fi
exit "$status"
