#!/usr/bin/env bash
# ECHO: plasticity mode shadow -> active on the live original, by a forward policy
# checkpoint at the unchanged tick (lop-nur-twin docs/EVA_ECHO_ACTIVATION.md,
# "Changing the mode later"). The owner chose active mode on 2026-11-07, ahead of the
# planned 7-day shadow period. Root, in its own transient unit; stops at the first
# failure. The same release runs every mode, so on any failure it starts the service
# again, in whatever mode the store's head holds. Never a restore.
set -euo pipefail

SERVICE=bethesda-life
PREFIX=/opt/bethesda-life
NODE=$PREFIX/node/bin/node
STORE=/var/lib/bethesda-life/store
RECORDS=/var/lib/bethesda-life-backup
BACKUPS=/var/backups/bethesda-life
MERGE=5cc50355148dfc53b3e773bb87b07025d7e94b96
RELEASE=$PREFIX/releases/$MERGE
INDIVIDUAL=04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921
OUT=/var/tmp/echo-plasticity-active
REASON="The owner chose active mode on 2026-11-07, after shadow activation. Held-out research flies showed no benefit established (weak-legs meals +0.17, 95% CI -1.00 to 1.33); it slows a walk only when its own walks keep failing and touches no reflex or safety gate."

stopped=no
log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
service() {
  printf '%s, pid %s, restarts %s, release %s' "$(systemctl is-active "$SERVICE" || true)" \
    "$(systemctl show -p MainPID --value "$SERVICE")" "$(systemctl show -p NRestarts --value "$SERVICE")" \
    "$(basename "$(readlink -f "$PREFIX/current")")"
}
finish() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$stopped" = yes ]; then
    log "starting $SERVICE again (same release; the store's head decides the mode)"
    systemctl start "$SERVICE" || true
    log "service: $(service)"
  fi
  if [ "$status" -ne 0 ]; then log "STOPPED (exit $status)"; else log "DONE"; fi
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
# validate check|commit FILE (no leading dashes: node would take them for its own options)
validate() {
  "$NODE" --max-old-space-size=256 -e '
    const [mode, file, individual, head, tick] = process.argv.slice(1);
    const r = JSON.parse(require("fs").readFileSync(file, "utf8").trim().split("\n").at(-1));
    const bad = [];
    if (r.mode !== "--" + mode) bad.push("mode " + r.mode);
    if (r.individual !== individual) bad.push("individual " + r.individual);
    if (r.from !== "shadow") bad.push("from " + r.from);
    if (r.to !== "active") bad.push("to " + r.to);
    if (r.sequence !== Number(head) + 1) bad.push("sequence " + r.sequence + " does not follow head " + head);
    if (r.tick !== Number(tick)) bad.push("tick " + r.tick + " is not the head tick " + tick);
    if (mode === "commit" && !r.committedUtc) bad.push("nothing committed");
    if (mode === "check" && r.committedUtc !== null) bad.push("a check committed");
    if (bad.length) { console.error("validate: " + bad.join("; ")); process.exit(1); }
    console.log("validate --" + mode + ": ECHO " + r.individual.slice(0, 8) + ", " + r.from + " -> " + r.to +
      ", checkpoint " + r.sequence + " at tick " + r.tick + (r.committedUtc ? ", committed " + r.committedUtc : ""));
  ' "$1" "$2" "$INDIVIDUAL" "$H" "$TICK"
}
policy() { # check|commit, as the service user, from the running release
  local mode=$1
  shift
  systemd-run --wait --collect --quiet --unit="$SERVICE-plasticity-policy-$mode" \
    -p User="$SERVICE" -p Group="$SERVICE" -p WorkingDirectory="$RELEASE" "$@" \
    -p StandardOutput="file:$OUT/$mode.out" -p StandardError="file:$OUT/$mode.err" \
    "$NODE" --max-old-space-size=4096 scripts/run-ts.mjs scripts/bethesda-life-plasticity-policy.ts \
    --store "$STORE" --to active --reason "$REASON" "--$mode"
}

[ "$(id -u)" -eq 0 ] || die "run it as root"
mkdir -p "$OUT"
log "ECHO plasticity: shadow -> active, on release $MERGE"
log "service: $(service)"
[ "$(readlink -f "$PREFIX/current")" = "$RELEASE" ] || die "the running release is not $MERGE"
[ "$(systemctl is-active "$SERVICE" || true)" = active ] || die "the service is not active"
grep -q "$INDIVIDUAL" "$STORE/individual.json" || die "this store is not ECHO's"

log "stopping $SERVICE (it commits a last checkpoint and releases its lease)"
stopped=yes
systemctl stop "$SERVICE"
[ "$(systemctl is-active "$SERVICE" || true)" != active ] || die "the service did not stop"
[ "$(systemctl show -p MainPID --value "$SERVICE")" -eq 0 ] || die "the service's process is still there"
H=$(head_seq)
log "stopped; head checkpoint $H"

log "backup of the stopped store (restored and checked by backup.sh, uploaded off site)"
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
log "backup: $ARCHIVE, sha256 $SHA, checkpoint $CP, tick $TICK, uploaded off site"

log "policy --check (read-only)"
start=$SECONDS
set +e
policy check
c=$?
set -e
log "check: exit $c in $((SECONDS - start)) s"
cat "$OUT/check.err" "$OUT/check.out"
[ "$c" -eq 0 ] || die "the check refused or failed (above)"
validate check "$OUT/check.out" || die "the check's result is not the expected change"

log "policy --commit"
exec 9>/run/bethesda-life-backup.lock
flock -n 9 || die "a backup or an install is at work"
[ "$(head_seq)" = "$H" ] || die "the head moved while the service was stopped"
start=$SECONDS
set +e
policy commit --setenv=ECHO_PLASTICITY_APPROVE_INDIVIDUAL="$INDIVIDUAL" --setenv=ECHO_PLASTICITY_APPROVE_MODE=active
k=$?
set -e
exec 9>&-
log "commit: exit $k in $((SECONDS - start)) s; head now $(head_seq)"
cat "$OUT/commit.err" "$OUT/commit.out"
[ "$k" -eq 0 ] || die "the commit refused or failed (above)"
[ "$(head_seq)" -eq $((H + 1)) ] || die "the head is $(head_seq), expected $((H + 1))"
validate commit "$OUT/commit.out" || die "the commit's result is not the expected change"

log "starting $SERVICE in active mode; watching it for 90 s"
before=$(systemctl show -p NRestarts --value "$SERVICE")
systemctl start "$SERVICE"
sleep 90
[ "$(systemctl is-active "$SERVICE" || true)" = active ] || die "the service did not stay up"
[ "$(systemctl show -p NRestarts --value "$SERVICE")" = "$before" ] || die "the service restarted"
stopped=no
log "service: $(service)"
