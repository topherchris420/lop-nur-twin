#!/usr/bin/env bash
# Backs up the Bethesda life's store while it lives, and proves the copy
# resumes: a tar of /var/lib/bethesda-life/store, unpacked again and checked
# with the installed release (--check: every seal and link, then the head
# restored in memory). Run it as root on the machine.
#
#   sudo deploy/bethesda-life/backup.sh [DIR]     (default /var/backups/bethesda-life)
#
# Then copy the archive off the machine, from your own computer:
#   ssh ubuntu@VM sudo cat /var/backups/bethesda-life/NAME.tar.gz > NAME.tar.gz
# A backup is this individual, not a new one: restore it only in place of a
# store that is lost or broken, never beside one that still lives.
set -euo pipefail

SERVICE=bethesda-life
PREFIX=/opt/bethesda-life
STATE=/var/lib/bethesda-life
out=${1:-/var/backups/bethesda-life}

die() {
  printf 'backup.sh: %s\n' "$*" >&2
  exit 1
}
[ "$(id -u)" -eq 0 ] || die "run it as root (sudo)"
[ -f "$STATE/store/individual.json" ] || die "no store at $STATE/store"
release=$(readlink -f "$PREFIX/current" || true)
[ -f "$release/RELEASE" ] || die "nothing is installed in $PREFIX (run install.sh)"
commit=$(sed -n 's/^commit //p' "$release/RELEASE")
heap_mb=$(systemctl show -p Environment --value "$SERVICE" |
  sed -n 's/.*--max-old-space-size=\([0-9][0-9]*\).*/\1/p')
[ -n "$heap_mb" ] || die "$SERVICE sets no --max-old-space-size"

install -d -m 0700 "$out"
name=bethesda-life-$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:12}
check=$(mktemp -d "$STATE/backup-check.XXXXXX")
trap 'rm -rf "$check" "$out/$name.tar.gz.part"' EXIT

# Every file in the store is published whole (written aside, then linked or
# renamed into place), so a copy taken while the life runs holds whole files:
# the chain up to some checkpoint, perhaps not the one being written as it ran.
tar --create --gzip --file "$out/$name.tar.gz.part" --exclude='*.tmp' \
  --directory "$STATE" store
tar --extract --gzip --file "$out/$name.tar.gz.part" --directory "$check"
chown -R "$SERVICE:$SERVICE" "$check"
if ! result=$(cd "$release" && runuser -u "$SERVICE" -- "$PREFIX/node/bin/node" \
  --max-old-space-size="$heap_mb" scripts/run-ts.mjs scripts/bethesda-life-headless.ts \
  --store "$check/store" --check); then
  die "the copy does not resume (above), so it was not kept; take another"
fi

mv "$out/$name.tar.gz.part" "$out/$name.tar.gz"
(cd "$out" && sha256sum "$name.tar.gz" >"$name.tar.gz.sha256")
printf '%s\n' "$result" | sed -n 's/.*"tick":\([0-9]*\).*"individual":"\([0-9a-f]*\)","checkpoint":\([0-9]*\).*/individual \2, checkpoint \3, tick \1/p'
printf 'kept %s (%s), written by release %s\n' "$out/$name.tar.gz" \
  "$(du -h "$out/$name.tar.gz" | cut -f1)" "$commit"
