#!/usr/bin/env bash
# Backs up the Bethesda life's store while it lives, and proves the copy
# resumes: a tar of /var/lib/bethesda-life/store, unpacked again and checked
# with the installed release (--check: every seal and link, then the head
# restored in memory). Run it as root on the machine.
#
#   sudo deploy/bethesda-life/backup.sh [--keep N] [DIR]     (default /var/backups/bethesda-life)
#
#   --keep N   then delete all but the newest N archives in DIR
#
# The check holds a whole life in memory beside the living one. When the
# machine cannot spare that, or another backup or install.sh is at work, it
# takes no copy and exits 75: try again later. With /etc/bethesda-life/offsite.env
# (root's, mode 0600) holding
#   OFFSITE_URL=https://objectstorage.REGION.oraclecloud.com/p/.../n/NAMESPACE/b/BUCKET/o/
# a pre-authenticated request that may only write objects to an Oracle
# Object Storage bucket, it uploads each archive it keeps, and its checksum,
# there; Object Storage refuses an upload that does not match the MD5 sent
# with it. Each run records what it did in /var/lib/bethesda-life-backup/
# status.json, which Caddy serves at /v1/backup for the watcher
# (.github/workflows/bethesda-life-watch.yml). install.sh --backups installs
# it with a timer that runs it every 6 hours.
#
# To copy an archive off the machine yourself, from your own computer:
#   ssh ubuntu@VM sudo cat /var/backups/bethesda-life/NAME.tar.gz > NAME.tar.gz
# A backup is this individual, not a new one: restore it only in place of a
# store that is lost or broken, never beside one that still lives.
set -Eeuo pipefail
export LC_ALL=C

SERVICE=bethesda-life
PREFIX=/opt/bethesda-life
STATE=/var/lib/bethesda-life
RECORDS=/var/lib/bethesda-life-backup
OFFSITE_ENV=/etc/bethesda-life/offsite.env
# The check's peak resident memory: 3.06 GB and 3.36 GB with 76 MB heads
# (docs/ECHO_ORGANISM_CONTINUATION.md), rounded up. It grows with the head.
CHECK_MB=${BACKUP_CHECK_MB:-3400}

usage() {
  printf 'backup.sh: %s (see --help)\n' "$1" >&2
  exit 2
}
out=/var/backups/bethesda-life keep=
while [ $# -gt 0 ]; do
  case $1 in
    --keep)
      [ $# -ge 2 ] && [[ $2 =~ ^[1-9][0-9]*$ ]] || usage "--keep needs a count of 1 or more"
      keep=$2
      shift
      ;;
    -h | --help)
      sed -n '2,/^set -E/p' "$0" | sed '$d; s/^# \{0,1\}//'
      exit 0
      ;;
    -*) usage "unknown option $1" ;;
    *) out=$1 ;;
  esac
  shift
done

now=$(date -u +%s)
started=$(date -u -d "@$now" +%Y-%m-%dT%H:%M:%SZ)
result=failed detail= offsite="not attempted" check= part=
die() {
  detail=$*
  printf 'backup.sh: %s\n' "$*" >&2
  exit 1
}
[ "$(id -u)" -eq 0 ] || die "run it as root (sudo)"

# One at a time, and none while install.sh checks or switches the life (it
# takes the same lock). A run that finds it held records nothing, so the
# record stays the running one's.
exec 9>/run/bethesda-life-backup.lock
if ! flock -n 9; then
  printf 'backup.sh: another backup, or install.sh, is at work; no copy taken, try later\n' >&2
  exit 75
fi

# The records the watcher reads, each replaced whole and readable by Caddy.
# They hold only what anyone may know: no path into the store, and nothing
# of the off-site URL.
put() {
  local tmp
  tmp=$(mktemp "$RECORDS/.record.XXXXXX")
  printf '%s\n' "$2" >"$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$RECORDS/$1"
}
# A JSON string of $1, without the quotes, backslashes and control characters
# that could end or escape it.
text() { printf '"%s"' "$(printf '%s' "$1" | tr -d '"\\\000-\037' | cut -c1-240)"; }
record() {
  local why=null
  [ -z "$detail" ] || why=$(text "$detail")
  put attempt.json "{\"utc\":\"$started\",\"result\":\"$result\",\"detail\":$why,\"offsite\":$(text "$offsite")}"
  put status.json "{\"schema\":\"bethesda-life-backup/v1\",\"attempt\":$(cat "$RECORDS/attempt.json"),\"kept\":$(cat "$RECORDS/kept.json" 2>/dev/null || echo null),\"offsite\":$(cat "$RECORDS/offsite.json" 2>/dev/null || echo null)}"
}
finish() {
  local code=$?
  if [ -n "$check" ]; then rm -rf "$check"; fi
  if [ -n "$part" ]; then rm -f "$part"; fi
  record || printf 'backup.sh: this run could not be recorded in %s\n' "$RECORDS" >&2
  exit "$code"
}
install -d -m 0755 "$RECORDS"
trap 'detail=${detail:-"stopped at line $LINENO"}' ERR
trap finish EXIT
skip() {
  result=skipped detail=$*
  printf 'backup.sh: %s; no copy taken, try later\n' "$*" >&2
  exit 75
}

[ -f "$STATE/store/individual.json" ] || die "no store at $STATE/store"
release=$(readlink -f "$PREFIX/current" || true)
[ -f "$release/RELEASE" ] || die "nothing is installed in $PREFIX (run install.sh)"
commit=$(sed -n 's/^commit //p' "$release/RELEASE")
heap_mb=$(systemctl show -p Environment --value "$SERVICE" |
  sed -n 's/.*--max-old-space-size=\([0-9][0-9]*\).*/\1/p')
[ -n "$heap_mb" ] || die "$SERVICE sets no --max-old-space-size"

# What a run that was killed left behind: a copy being checked, a part-written
# archive. Never a kept archive, never the store.
rm -rf "$STATE"/backup-check.*
rm -f "$out"/*.tar.gz.part

# Memory the check may take beside the life: what is available, less what
# the life may still grow to (its high-water mark, and at least its heap: it
# peaks as it resumes and as it commits), less 512 MB to spare.
spare_mb() {
  local available pid peak= rss=
  available=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
  pid=$(systemctl show -p MainPID --value "$SERVICE")
  if [ "${pid:-0}" -gt 0 ]; then
    peak=$(awk '/^VmHWM:/ { print int($2 / 1024) }' "/proc/$pid/status" 2>/dev/null || true)
    rss=$(awk '/^VmRSS:/ { print int($2 / 1024) }' "/proc/$pid/status" 2>/dev/null || true)
  fi
  if [ -n "$peak" ] && [ -n "$rss" ]; then
    [ "$peak" -ge "$heap_mb" ] || peak=$heap_mb
    [ "$rss" -ge "$peak" ] || available=$((available - (peak - rss)))
  fi
  echo $((available - 512))
}
# A life that is starting (or waiting to restart) has no high-water mark yet
# and is about to resume, when it needs the most.
case $(systemctl is-active "$SERVICE" 2>/dev/null || true) in
  activating | deactivating | reloading) skip "$SERVICE is starting or stopping" ;;
esac
spare=$(spare_mb)
[ "$spare" -ge "$CHECK_MB" ] ||
  skip "$spare MB to spare beside the life, and the check needs $CHECK_MB MB"

install -d -m 0700 "$out"
name=bethesda-life-$(date -u -d "@$now" +%Y%m%dT%H%M%SZ)-${commit:0:12}
part=$out/$name.tar.gz.part
check=$(mktemp -d "$STATE/backup-check.XXXXXX")

# Every file in the store is published whole (written aside, then linked or
# renamed into place), so a copy taken while the life runs holds whole files:
# the chain up to some checkpoint, perhaps not the one being written as it ran.
# GNU tar still exits 1 ("file changed as we read it") when the life commits
# while it reads the store, so it copies again, up to three times, 10 s
# apart. Whichever copy is kept, the check below proves it resumes.
for try in 1 2 3; do
  status=0
  tar --create --gzip --file "$part" --exclude='*.tmp' --directory "$STATE" store || status=$?
  [ "$status" -eq 1 ] && [ "$try" -lt 3 ] || break
  printf 'backup.sh: the store changed while it was copied; copying again (%s of 3)\n' "$((try + 1))" >&2
  sleep 10
done
[ "$status" -eq 0 ] || die "tar could not copy the store (exit $status, try $try of 3)"
tar --extract --gzip --file "$part" --directory "$check"
chown -R "$SERVICE:$SERVICE" "$check"
if checked=$(cd "$release" && runuser -u "$SERVICE" -- "$PREFIX/node/bin/node" \
  --max-old-space-size="$heap_mb" scripts/run-ts.mjs scripts/bethesda-life-headless.ts \
  --store "$check/store" --check); then
  :
else
  code=$?
  [ "$code" -lt 128 ] ||
    die "the check was killed by signal $((code - 128)) (out of memory?), so the copy was not kept; take another"
  die "the copy does not resume (above), so it was not kept; take another"
fi
individual=$(printf '%s\n' "$checked" |
  sed -n 's/.*"individual":"\([0-9a-f]\{64\}\)","checkpoint":\([0-9]*\).*/\1/p' | tail -n 1)
checkpoint=$(printf '%s\n' "$checked" |
  sed -n 's/.*"individual":"\([0-9a-f]\{64\}\)","checkpoint":\([0-9]*\).*/\2/p' | tail -n 1)
tick=$(printf '%s\n' "$checked" | sed -n 's/.*"tick":\([0-9]*\).*"individual":.*/\1/p' | tail -n 1)
[ -n "$individual" ] && [ -n "$checkpoint" ] && [ -n "$tick" ] ||
  die "the check passed but printed no individual, checkpoint and tick; the copy was not kept"

# The head's digest and commit time, from the copy the check just verified,
# for the watcher's public ledger (src/bethesda/life/ledger.ts): every
# checkpoint names its parent's digest, so this one fixes the history back to
# birth. A record without them still keeps the archive.
anchor=
head_file=$(find "$check/store/checkpoints" -maxdepth 1 -name '[0-9]*.json' | sort | tail -n 1)
if read -r seq digest committed < <(cd "$release" && runuser -u "$SERVICE" -- \
  "$PREFIX/node/bin/node" --max-old-space-size="$heap_mb" -e '
    const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    console.log(s.checkpoint.sequence, s.checkpoint.digest, s.committedUtc);' "$head_file") &&
  [ "$seq" = "$checkpoint" ] && [[ $digest =~ ^[0-9a-f]{64}$ ]] &&
  [[ $committed =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$ ]]; then
  anchor=",\"digest\":\"$digest\",\"committed\":\"$committed\""
else
  printf 'backup.sh: could not read checkpoint %s'\''s digest; the record will not carry it\n' "$checkpoint" >&2
fi

mv "$part" "$out/$name.tar.gz"
part=
(cd "$out" && sha256sum "$name.tar.gz" >"$name.tar.gz.sha256")
result=kept
put kept.json "{\"utc\":\"$started\",\"archive\":\"$name.tar.gz\",\"sha256\":\"$(cut -d' ' -f1 "$out/$name.tar.gz.sha256")\",\"bytes\":$(stat -c %s "$out/$name.tar.gz"),\"individual\":\"$individual\",\"checkpoint\":$checkpoint,\"tick\":$tick,\"release\":\"$commit\"$anchor}"
rm -rf "$check"
check=
printf 'individual %s, checkpoint %s, tick %s%s\n' "$individual" "$checkpoint" "$tick" \
  "${anchor:+, digest $digest}"
printf 'kept %s (%s), written by release %s\n' "$out/$name.tar.gz" \
  "$(du -h "$out/$name.tar.gz" | cut -f1)" "$commit"

if [ -n "$keep" ]; then
  # Their names begin with the UTC time, so the glob lists them oldest first.
  archives=("$out"/bethesda-life-*.tar.gz)
  for ((i = 0; i < ${#archives[@]} - keep; i++)); do
    rm -f -- "${archives[i]}" "${archives[i]}.sha256"
    printf 'deleted %s (keeping the newest %s)\n' "${archives[i]}" "$keep"
  done
fi

# The pre-authenticated request's URL is a credential: it reaches no command
# line (where any local user could read it), journal line or record.
par=
if [ ! -e "$OFFSITE_ENV" ]; then
  offsite="not configured"
elif [ "$(stat -c '%u %a' "$OFFSITE_ENV")" != "0 600" ]; then
  offsite="refused: $OFFSITE_ENV must be root's, with mode 0600"
elif ! command -v curl >/dev/null || ! command -v openssl >/dev/null; then
  offsite="refused: uploading needs curl and openssl"
else
  par=$(sed -n 's/^OFFSITE_URL=//p' "$OFFSITE_ENV" | tail -n 1)
  form='^https://objectstorage\.[a-z0-9.-]+/p/[^[:space:]]+/n/[^/[:space:]]+/b/[^/[:space:]]+/o/$'
  if ! [[ $par =~ $form ]] || [[ $par == *[\"\\]* ]]; then
    par=
    offsite="refused: OFFSITE_URL in $OFFSITE_ENV is not a bucket's pre-authenticated request ending in /o/"
  fi
fi
# upload FILE: a PUT of FILE into the bucket under its own name, with its MD5.
upload() {
  local md5
  md5=$(openssl dgst -md5 -binary "$1" | base64)
  printf 'url = "%s%s"\n' "$par" "$(basename "$1")" |
    curl --config - --fail --silent --show-error --upload-file "$1" \
      --header "Content-MD5: $md5" --connect-timeout 30 --max-time 600 \
      --retry 4 --retry-delay 60 --retry-all-errors --output /dev/null \
      2> >(sed 's#https\{0,1\}://[^[:space:]]*#<url>#g' >&2)
}
if [ -n "$par" ]; then
  if upload "$out/$name.tar.gz" && upload "$out/$name.tar.gz.sha256"; then
    offsite=uploaded
    put offsite.json "{\"utc\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"archive\":\"$name.tar.gz\"}"
  else
    offsite="failed: curl exited $?"
  fi
fi
printf 'off-site copy: %s\n' "$offsite"
case $offsite in uploaded | "not configured") ;; *) exit 1 ;; esac
