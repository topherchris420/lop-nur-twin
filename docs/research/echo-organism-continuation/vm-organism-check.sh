#!/usr/bin/env bash
# Cutover step 3 (docs/ECHO_ORGANISM_CONTINUATION.md#cutover-plan), as root on
# the VM: checkpoint 270's header, then the organism continuation's --check,
# both against an unpacked copy of a fresh backup. The copy is read-only to
# the service user and deleted afterwards. Nothing is committed, stopped or
# switched.
#
# Beside the running service it starts only if memory holds both at their
# peaks: the check's (3.06 GB on a 76 MB head; CHECK_MB allowed) and the
# service growing from its resident size back to its high-water mark.
# Otherwise it stops, and the step runs in the window, after step 5. All it
# starts is the kernel's first out-of-memory victim (the service has
# OOMScoreAdjust=500), and the check runs at the lowest CPU priority under a
# memory cap, so the service is never the one stopped.
#
#   sudo bash vm-organism-check.sh /var/backups/bethesda-life/NAME.tar.gz /opt/bethesda-life/releases/COMMIT
set -euo pipefail

SERVICE=bethesda-life
NODE=/opt/bethesda-life/node/bin/node
SOURCE_RELEASE=/opt/bethesda-life/releases/d25e1f3b9e40c5ded3f8ce1f435365d5c6c80592
INDIVIDUAL=04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921
PARENT_270=54f369efaed0183a69344700677afa179fce5f217efee33348afd28a77720ac1
GRAPH_270=29ef122c0f1fec81f8f313bb53124d87b36024e9249e74db2c3ab17d562c5527
CHECK_MB=3300
MEMORY_MAX=4608M

die() {
  printf 'vm-organism-check.sh: %s\n' "$*" >&2
  exit 1
}
[ $# -eq 2 ] || die "usage: vm-organism-check.sh BACKUP.tar.gz RELEASE_DIR"
backup=$1
release=$2
[ "$(id -u)" -eq 0 ] || die "run it as root (sudo)"
for f in "$backup" "$release/RELEASE" "$release/scripts/bethesda-life-continue-organism.ts" "$SOURCE_RELEASE/RELEASE"; do
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
[ "$available" -ge "$need" ] || die "too little memory beside the service: run this step in the window, after step 5"

dir=$(mktemp -d "/var/lib/$SERVICE/organism-check.XXXXXX")
trap 'rm -rf "$dir"' EXIT
tar --extract --gzip --no-same-owner --file "$backup" --directory "$dir"
chown -R "root:$SERVICE" "$dir"
chmod -R u=rwX,g=rX,o= "$dir"
runuser -u "$SERVICE" -- test -r "$dir/store/individual.json" || die "$SERVICE cannot read the copy"
if runuser -u "$SERVICE" -- test -w "$dir/store/checkpoints"; then die "$SERVICE can write to the copy"; fi
manifest() { (cd "$dir/store" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-64); }
hashes=$(manifest)
echo "copy: $(find "$dir/store" -type f | wc -l) files, $(du -sm "$dir/store" | cut -f1) MB, read-only to $SERVICE"

# Checkpoint 270, the v3 continuation the VM committed: everything but its graph.
h=$("$NODE" --max-old-space-size=1024 -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).checkpoint;
  console.log(c.sequence, c.birth.individual, c.parent, c.graphDigest, c.versions.echo);
' "$dir/store/checkpoints/000000000270.json")
read -r sequence individual parent graph echo_version <<<"$h"
echo "checkpoint 270: sequence $sequence, individual $individual, parent $parent, graph $graph, $echo_version"
if [ "$sequence" != 270 ] || [ "$individual" != "$INDIVIDUAL" ] || [ "$parent" != "$PARENT_270" ] || [ "$graph" != "$GRAPH_270" ]; then
  die "checkpoint 270 is not what the rehearsal rebuilt: the cutover stops here"
fi
echo "checkpoint 270: as the rehearsal rebuilt it"

hook='data:text/javascript,process.on("exit",()=>process.stderr.write("peak-rss-kb "+process.resourceUsage().maxRSS+String.fromCharCode(10)))'
echo "check: release $(sed -n 's/^commit //p' "$release/RELEASE") from $SOURCE_RELEASE; heap 4096 MB, cap $MEMORY_MAX, nice 19"
start=$SECONDS
set +e
(cd "$release" && systemd-run --scope --quiet -p MemoryMax="$MEMORY_MAX" -p MemorySwapMax=0 \
  bash -c 'echo 1000 >/proc/self/oom_score_adj && exec "$@"' _ \
  nice -n 19 runuser -u "$SERVICE" -- "$NODE" --max-old-space-size=4096 --import="$hook" \
  scripts/run-ts.mjs scripts/bethesda-life-continue-organism.ts \
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
