#!/usr/bin/env bash
# ECHO: the embodied plasticity continuation, in shadow mode, on the live original
# (lop-nur-twin docs/EVA_ECHO_ACTIVATION.md, gates E4 to E9), approved by the owner on
# 2026-11-07. Root, in its own transient unit, so a dropped SSH connection cannot stop
# it halfway. Every step is logged; it stops at the first failure.
#
# Until the commit, any failure starts the unchanged release e458f7c again and nothing
# has changed. After the commit it never starts an older release: the old engine
# refuses the continued checkpoint by design, and restoring a backup would fork the
# individual.
#
# E7 runs inside the window on a copy of the window's own backup (newer evidence than
# a copy of an earlier backup): beside the running service this VM has too little
# memory for it, as on 2026-11-04.
set -euo pipefail

SERVICE=bethesda-life
PREFIX=/opt/bethesda-life
NODE=$PREFIX/node/bin/node
STATE=/var/lib/bethesda-life
STORE=$STATE/store
RECORDS=/var/lib/bethesda-life-backup
BACKUPS=/var/backups/bethesda-life
REPO=/home/ubuntu/lop-nur-twin
MERGE=5cc50355148dfc53b3e773bb87b07025d7e94b96
SOURCE=e458f7cb34904d85127779a3700c26b376ab4a80
SOURCE_RELEASE=$PREFIX/releases/$SOURCE
RELEASE=$PREFIX/releases/$MERGE
INDIVIDUAL=04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921
OUT=/var/tmp/echo-plasticity-cutover

stopped=no
committed=no
copy=
log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
service() {
  printf '%s, pid %s, restarts %s, release %s' "$(systemctl is-active "$SERVICE" || true)" \
    "$(systemctl show -p MainPID --value "$SERVICE")" "$(systemctl show -p NRestarts --value "$SERVICE")" \
    "$(basename "$(readlink -f "$PREFIX/current")")"
}
finish() {
  local status=$?
  if [ -n "$copy" ]; then rm -rf "$copy"; fi
  if [ "$status" -ne 0 ]; then
    if [ "$stopped" = yes ] && [ "$committed" = no ]; then
      log "nothing was committed: starting the unchanged release $SOURCE again"
      systemctl start "$SERVICE" || true
      log "service: $(service)"
    elif [ "$committed" = yes ]; then
      log "THE CONTINUATION IS COMMITTED: no older release may start. Service left as it is: $(service)"
    fi
    log "STOPPED (exit $status)"
  else
    log "DONE"
  fi
}
trap finish EXIT
die() {
  log "FAILED: $*"
  exit 1
}
head_seq() {
  local f
  f=$(find "$STORE/checkpoints" -maxdepth 1 -name '[0-9]*.json' | sort | tail -n 1)
  f=$(basename "$f" .json)
  echo $((10#$f))
}
# validate check|commit FILE (no leading dashes: node would read them as its own options): the continuation script's JSON line against this cutover's head.
validate() {
  "$NODE" --max-old-space-size=256 -e '
    const [mode, file, individual, source, head, tick] = process.argv.slice(1);
    const r = JSON.parse(require("fs").readFileSync(file, "utf8").trim().split("\n").at(-1));
    const bad = [];
    if (r.mode !== "--" + mode) bad.push("mode " + r.mode);
    if (r.individual !== individual) bad.push("individual " + r.individual);
    if (r.sourceRelease !== source) bad.push("source release " + r.sourceRelease);
    if (r.sequence !== Number(head) + 1) bad.push("sequence " + r.sequence + " does not follow head " + head);
    if (r.tick !== Number(tick)) bad.push("tick " + r.tick + " is not the head tick " + tick);
    if (r.preservedGraphDigest !== r.sourceGraphDigest) bad.push("graph not preserved");
    if (r.shadowUnchanged !== true) bad.push("shadow mode changed the organism");
    if (r.startMode !== "shadow") bad.push("start mode " + r.startMode);
    if (mode === "commit" && !r.committedUtc) bad.push("nothing committed");
    if (mode === "check" && r.committedUtc !== null) bad.push("a check committed");
    if (bad.length) { console.error("validate: " + bad.join("; ")); process.exit(1); }
    console.log("validate --" + mode + ": ECHO " + r.individual.slice(0, 8) + ", checkpoint " + r.sequence +
      " at tick " + r.tick + ", graph kept " + r.preservedGraphDigest + ", shadow unchanged, starts in shadow" +
      (r.committedUtc ? ", committed " + r.committedUtc : ""));
  ' "$1" "$2" "$INDIVIDUAL" "$SOURCE" "$H" "$TICK"
}

[ "$(id -u)" -eq 0 ] || die "run it as root"
mkdir -p "$OUT"
[ ! -e "$OUT/committed" ] || die "this script already committed a continuation"
log "ECHO plasticity cutover from $SOURCE to merge $MERGE"
log "service: $(service)"
[ "$(readlink -f "$PREFIX/current")" = "$SOURCE_RELEASE" ] || die "the running release is not $SOURCE"
[ "$(systemctl is-active "$SERVICE" || true)" = active ] || die "the service is not active"
grep -q "$INDIVIDUAL" "$STORE/individual.json" || die "this store is not ECHO's"
[ -x "$PREFIX/bin/backup.sh" ] || die "no installed backup.sh"

log "E6: check out $MERGE and prepare its release beside the running one"
runuser -u ubuntu -- env HOME=/home/ubuntu git -C "$REPO" fetch --quiet --depth 1 origin "$MERGE"
runuser -u ubuntu -- env HOME=/home/ubuntu git -C "$REPO" checkout --quiet --detach FETCH_HEAD
[ "$(git -c safe.directory="$REPO" -C "$REPO" rev-parse HEAD)" = "$MERGE" ] || die "the checkout is not $MERGE"
"$REPO/deploy/bethesda-life/install.sh" --prepare
grep -qx "commit $MERGE" "$RELEASE/RELEASE" || die "no prepared release at $RELEASE"
[ "$(readlink -f "$PREFIX/current")" = "$SOURCE_RELEASE" ] || die "prepare switched the release"
[ "$(systemctl is-active "$SERVICE" || true)" = active ] || die "prepare stopped the service"
log "E6: prepared; service: $(service)"

log "E5: live state before the window: head checkpoint $(head_seq); last backup record:"
cat "$RECORDS/status.json"
echo

log "E8 window opens: stopping $SERVICE (it commits a last checkpoint and releases its lease)"
stopped=yes
systemctl stop "$SERVICE"
[ "$(systemctl is-active "$SERVICE" || true)" != active ] || die "the service did not stop"
[ "$(systemctl show -p MainPID --value "$SERVICE")" -eq 0 ] || die "the service's process is still there"
H=$(head_seq)
log "stopped; head checkpoint $H"

log "E4: back up the stopped store (backup.sh restores and checks it, then uploads it off site)"
set +e
"$PREFIX/bin/backup.sh" --keep 8
b=$?
set -e
[ "$b" -eq 0 ] || die "backup.sh exited $b"
read -r ARCHIVE SHA CP TICK OFF <<<"$("$NODE" --max-old-space-size=256 -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const up = s.attempt.offsite === "uploaded" && s.offsite && s.offsite.archive === s.kept.archive;
  console.log(s.kept.archive, s.kept.sha256, s.kept.checkpoint, s.kept.tick, up ? "uploaded" : "not-uploaded");
' "$RECORDS/status.json")"
[ "$CP" = "$H" ] || die "the backup holds checkpoint $CP, not the head $H"
[ "$OFF" = uploaded ] || die "the backup was not uploaded off site"
echo "$SHA  $BACKUPS/$ARCHIVE" | sha256sum --check --quiet || die "$ARCHIVE does not match its recorded SHA-256"
log "E4: $ARCHIVE, sha256 $SHA, checkpoint $CP, tick $TICK, uploaded off site"

log "E7: the continuation's --check on a copy of that backup, read-only to $SERVICE"
copy=$(mktemp -d "$STATE/plasticity-check.XXXXXX")
tar --extract --gzip --no-same-owner --file "$BACKUPS/$ARCHIVE" --directory "$copy"
chown -R "root:$SERVICE" "$copy"
chmod -R u=rwX,g=rX,o= "$copy"
runuser -u "$SERVICE" -- test -r "$copy/store/individual.json" || die "$SERVICE cannot read the copy"
if runuser -u "$SERVICE" -- test -w "$copy/store/checkpoints"; then die "$SERVICE can write to the copy"; fi
manifest() { (cd "$copy/store" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-64); }
before=$(manifest)
start=$SECONDS
set +e
(cd "$RELEASE" && runuser -u "$SERVICE" -- "$NODE" --max-old-space-size=4096 scripts/run-ts.mjs \
  scripts/bethesda-life-continue-plasticity.ts --store "$copy/store" \
  --from-release "$SOURCE_RELEASE" --check) </dev/null >"$OUT/check.out" 2>"$OUT/check.err"
c=$?
set -e
log "E7: exit $c in $((SECONDS - start)) s"
cat "$OUT/check.err" "$OUT/check.out"
[ "$(manifest)" = "$before" ] || die "the check changed the copy"
rm -rf "$copy"
copy=
[ "$c" -eq 0 ] || die "the check refused or failed (above)"
validate check "$OUT/check.out" || die "the check's result is not the expected continuation"

log "E8: commit the continuation on the live store"
exec 9>/run/bethesda-life-backup.lock
flock -n 9 || die "a backup or an install is at work"
[ "$(head_seq)" = "$H" ] || die "the head moved while the service was stopped"
start=$SECONDS
set +e
systemd-run --wait --collect --quiet --unit="$SERVICE-plasticity-commit" \
  -p User="$SERVICE" -p Group="$SERVICE" -p WorkingDirectory="$RELEASE" \
  --setenv=ECHO_PLASTICITY_APPROVE_INDIVIDUAL="$INDIVIDUAL" \
  -p StandardOutput="file:$OUT/commit.out" -p StandardError="file:$OUT/commit.err" \
  "$NODE" --max-old-space-size=4096 scripts/run-ts.mjs scripts/bethesda-life-continue-plasticity.ts \
  --store "$STORE" --from-release "$SOURCE_RELEASE" --commit
k=$?
set -e
exec 9>&-
n=$(head_seq)
if [ "$n" != "$H" ]; then
  committed=yes
  date -u +%FT%TZ >"$OUT/committed"
fi
log "E8: exit $k in $((SECONDS - start)) s; head now $n"
cat "$OUT/commit.err" "$OUT/commit.out"
[ "$k" -eq 0 ] || die "the commit refused or failed (above)"
[ "$n" -eq $((H + 1)) ] || die "the head is $n, expected $((H + 1))"
validate commit "$OUT/commit.out" || die "the commit's result is not the expected continuation"

log "E9: switch to $MERGE and start (install.sh first checks that the release resumes the store)"
set +e
"$REPO/deploy/bethesda-life/install.sh"
i=$?
set -e
[ "$i" -eq 0 ] || die "install.sh exited $i"
[ "$(readlink -f "$PREFIX/current")" = "$RELEASE" ] || die "the current release is not $MERGE"
[ "$(systemctl is-active "$SERVICE" || true)" = active ] || die "the service is not active"
stopped=no
log "E9: service: $(service)"

log "E10 (first look): waiting up to 10 min for the first checkpoint lived on $MERGE"
for _ in $(seq 1 60); do
  [ "$(head_seq)" -gt $((H + 1)) ] && break
  sleep 10
done
f=$(find "$STORE/checkpoints" -maxdepth 1 -name '[0-9]*.json' | sort | tail -n 1)
"$NODE" --max-old-space-size=2048 -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).checkpoint;
  console.log(JSON.stringify({ sequence: c.sequence, tick: c.tick, individual: c.birth.individual,
    plasticity: c.versions.plasticity, fly: c.versions.fly }));
' "$f" || log "could not read the head here; read it from the observer instead"
log "service: $(service)"
