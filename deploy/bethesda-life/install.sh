#!/usr/bin/env bash
# Installs, upgrades or rolls back the Bethesda headless life as the systemd
# service bethesda-life on one Ubuntu machine. Run it as root from a checkout
# of this repository; it installs that checkout's HEAD commit.
#
#   sudo deploy/bethesda-life/install.sh --create     first install: a trial life, then the individual's birth
#   sudo deploy/bethesda-life/install.sh              upgrade: the same individual lives on, or nothing changes
#   sudo deploy/bethesda-life/install.sh --rollback   back to the release before the last upgrade
#   sudo deploy/bethesda-life/install.sh --prepare    build HEAD without stopping or switching the life
#
#   --controller echo   with --create: the fly runs Project ECHO's controller
#   --trial             run the trial life on an upgrade too (the life is paused meanwhile)
#   --skip-trial        skip it on --create
#
# Layout: Node and each release under /opt/bethesda-life, the store in
# /var/lib/bethesda-life/store (the boot volume), logs in the journal. The
# read-only observer (bethesda-life-observer) is installed beside the life on
# 127.0.0.1:8790; public.sh puts it on the internet.
# "Running it on one VM" in docs/BETHESDA_CONTINUOUS_LIFE.md has the steps
# around it: backup, recovery, and what each refusal means.
set -euo pipefail

NODE_VERSION=24.22.1
NODE_SHA256_X64=eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c
NODE_SHA256_ARM64=33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3
# A resume and every verified checkpoint hold the life several times over;
# measured in docs/BETHESDA_CONTINUOUS_LIFE.md. Below this the install stops.
MIN_MEMORY_MB=7000
SERVICE=bethesda-life
PREFIX=/opt/bethesda-life
STATE=/var/lib/bethesda-life
STORE=$STATE/store

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
unit=$here/$SERVICE.service
OBSERVER=bethesda-life-observer
observer_unit=$here/$OBSERVER.service

say() { printf '%s\n' "$*"; }
die() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}
git_() { git -c safe.directory="$repo" -C "$repo" "$@"; }

action=upgrade controller= trial=
while [ $# -gt 0 ]; do
  case $1 in
    --create) action=create ;;
    --rollback) action=rollback ;;
    --prepare) action=prepare ;;
    --controller)
      [ $# -ge 2 ] || die "--controller needs a value"
      controller=$2
      shift
      ;;
    --trial) trial=yes ;;
    --skip-trial) trial=no ;;
    -h | --help)
      sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
  shift
done
case $controller in '' | reduced-order | echo) ;; *) die "--controller is reduced-order or echo" ;; esac
[ -z "$controller" ] || [ "$action" = create ] || die "--controller only applies with --create"
if [ -z "$trial" ]; then
  if [ "$action" = create ]; then trial=yes; else trial=no; fi
fi

[ "$(id -u)" -eq 0 ] || die "run it as root (sudo)"
command -v systemctl >/dev/null || die "systemd is required"
case $(uname -m) in
  x86_64) arch=x64 sha=$NODE_SHA256_X64 ;;
  aarch64) arch=arm64 sha=$NODE_SHA256_ARM64 ;;
  *) die "no pinned Node build for $(uname -m)" ;;
esac
# The service's heap: this checkout's unit, or a larger one set in a drop-in.
heap_of() { sed -n 's/.*--max-old-space-size=\([0-9][0-9]*\).*/\1/p'; }
heap_mb=$(heap_of <"$unit")
[ -n "$heap_mb" ] || die "$unit sets no --max-old-space-size"
installed_heap=$(systemctl show -p Environment --value "$SERVICE" 2>/dev/null | heap_of || true)
if [ -n "$installed_heap" ] && [ "$installed_heap" -gt "$heap_mb" ]; then heap_mb=$installed_heap; fi
node_dir=$PREFIX/node-v$NODE_VERSION-linux-$arch

running() { systemctl is-active --quiet "$SERVICE"; }

# life RELEASE [NODE_FLAG...] -- RUNNER_ARG...: the runner, as the service
# user, with the service's heap, from the release's directory.
life() {
  local release=$1 flags=()
  shift
  while [ "$1" != -- ]; do
    flags+=("$1")
    shift
  done
  shift
  (cd "$release" && runuser -u "$SERVICE" -- "$node_dir/bin/node" \
    --max-old-space-size="$heap_mb" "${flags[@]}" \
    scripts/run-ts.mjs scripts/bethesda-life-headless.ts "$@")
}

check_machine() {
  local total_mb free_mb
  total_mb=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)
  [ "$total_mb" -ge "$MIN_MEMORY_MB" ] || die "this machine has ${total_mb} MB of memory and the life needs ${MIN_MEMORY_MB} MB.
  The checkpoints on disk are tens of megabytes, but resuming one, and
  verifying every new one by restoring it, holds the whole life several
  times over (measured in docs/BETHESDA_CONTINUOUS_LIFE.md). Swap is no
  substitute: the garbage collector walks the live heap. Use a larger shape."
  say "memory: ${total_mb} MB (the life needs ${MIN_MEMORY_MB} MB; heap ${heap_mb} MB)"

  id -u "$SERVICE" >/dev/null 2>&1 ||
    useradd --system --user-group --no-create-home --home-dir /nonexistent \
      --shell /usr/sbin/nologin "$SERVICE"
  install -d -o "$SERVICE" -g "$SERVICE" -m 0750 "$STATE"
  install -d -m 0755 "$PREFIX" "$PREFIX/releases"
  if [ "$(stat -c %d "$STATE")" != "$(stat -c %d /)" ]; then
    say "warning: $STATE is on $(findmnt -n -o SOURCE --target "$STATE"), not the root filesystem (the boot volume)"
  fi
  free_mb=$(df -Pm "$STATE" | awk 'NR == 2 { print $4 }')
  [ "$free_mb" -ge 2048 ] || die "$STATE has ${free_mb} MB free; keep at least 2 GB for the store"
}

ensure_node() {
  [ -x "$node_dir/bin/node" ] && return
  command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl ca-certificates; }
  local tmp file=node-v$NODE_VERSION-linux-$arch.tar.gz
  tmp=$(mktemp -d)
  say "node: downloading $file"
  curl -fsSL --proto '=https' -o "$tmp/$file" "https://nodejs.org/dist/v$NODE_VERSION/$file"
  printf '%s  %s\n' "$sha" "$tmp/$file" | sha256sum --check --quiet - ||
    die "$file does not match its pinned SHA-256"
  tar -xzf "$tmp/$file" -C "$tmp" --no-same-owner
  mv "$tmp/node-v$NODE_VERSION-linux-$arch" "$node_dir"
  rm -rf "$tmp"
}

# The files the runner imports, from HEAD (not the working tree), with the
# locked production dependencies. One directory per commit, never changed.
build_release() {
  commit=$(git_ rev-parse HEAD) || die "$repo is not a git checkout"
  release=$PREFIX/releases/$commit
  if [ -n "$(git_ status --porcelain --untracked-files=no)" ]; then
    say "note: uncommitted changes in $repo are not installed; HEAD $commit is"
  fi
  if [ -f "$release/RELEASE" ]; then
    say "release: $commit (already built)"
    return
  fi
  local tmp=$PREFIX/releases/.building-$commit
  rm -rf "$tmp"
  mkdir -p "$tmp"
  git_ archive --format=tar HEAD package.json package-lock.json scripts/run-ts.mjs \
    scripts/ts-hooks.mjs scripts/bethesda-life-headless.ts scripts/bethesda-life-observer.ts \
    scripts/bethesda-life-upgrade-echo.ts \
    src | tar -x -C "$tmp"
  say "release: $commit (installing its production dependencies)"
  (cd "$tmp" && PATH=$node_dir/bin:$PATH PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev \
    --ignore-scripts --no-audit --no-fund --loglevel=error)
  printf 'commit %s\nnode %s\nbuilt %s\n' "$commit" "$NODE_VERSION" "$(date -u +%FT%TZ)" >"$tmp/RELEASE"
  mv "$tmp" "$release"
}

# A throwaway individual in its own store, born, resumed for 3000 ticks with
# one verified checkpoint, then deleted: every path the service takes but
# the wall clock, on this machine's Node, CPU, memory and disk.
trial_life() {
  local dir start peak='data:text/javascript,process.on("exit",()=>process.stderr.write("peak-rss-kb "+process.resourceUsage().maxRSS+"\n"))'
  dir=$(mktemp -d "$STATE/trial.XXXXXX")
  chown "$SERVICE:$SERVICE" "$dir"
  say "trial: a throwaway life (born, 3000 ticks, one verified checkpoint, then deleted)"
  start=$SECONDS
  if ! life "$release" --import="$peak" -- --store "$dir" --create \
    ${controller:+--controller "$controller"} >/dev/null 2>"$STATE/trial.err" ||
    ! life "$release" --import="$peak" -- --store "$dir" --ticks 3000 >/dev/null 2>>"$STATE/trial.err"; then
    rm -rf "$dir"
    cat "$STATE/trial.err" >&2
    die "the trial life failed on this machine (above); nothing was installed"
  fi
  rm -rf "$dir"
  say "trial: passed in $((SECONDS - start)) s (3000 ticks are 300 s of the life's time); peak resident memory $(awk '/^peak-rss-kb/ { if ($2 > m) m = $2 } END { print int(m / 1024) }' "$STATE/trial.err") MB"
  rm -f "$STATE/trial.err"
}

switch_to() {
  local old
  old=$(readlink -f "$PREFIX/current" 2>/dev/null || true)
  if [ -n "$old" ] && [ "$old" != "$1" ]; then ln -sfn "$old" "$PREFIX/previous"; fi
  ln -sfn "$1" "$PREFIX/current.new" && mv -T "$PREFIX/current.new" "$PREFIX/current"
  ln -sfn "$node_dir" "$PREFIX/node.new" && mv -T "$PREFIX/node.new" "$PREFIX/node"
  install -m 0644 "$unit" "/etc/systemd/system/$SERVICE.service"
  install -m 0644 "$observer_unit" "/etc/systemd/system/$OBSERVER.service"
  systemctl daemon-reload
  systemctl enable --quiet "$SERVICE"
  # A release from before the observer has nothing for it to run.
  if [ -f "$1/scripts/$OBSERVER.ts" ]; then
    systemctl enable --quiet "$OBSERVER"
  else
    systemctl disable --now --quiet "$OBSERVER" 2>/dev/null || true
  fi
}

# Starts the service and watches it resume: a failed restore stops it at once.
start_and_watch() {
  local before
  before=$(systemctl show -p NRestarts --value "$SERVICE")
  systemctl restart "$SERVICE"
  say "started $SERVICE on $(readlink -f "$PREFIX/current"); watching it for 90 s"
  sleep 90
  if running && [ "$(systemctl show -p NRestarts --value "$SERVICE")" = "$before" ]; then
    say "$SERVICE is living. Follow it with: journalctl -u $SERVICE -f"
    journalctl -u "$SERVICE" -n 2 --no-pager -o cat || true
    if systemctl is-enabled --quiet "$OBSERVER" 2>/dev/null; then
      systemctl restart "$OBSERVER"
      sleep 3
      say "$OBSERVER: $(curl -s http://127.0.0.1:8790/v1/health 2>/dev/null || echo "not answering yet (journalctl -u $OBSERVER)")"
    fi
  else
    journalctl -u "$SERVICE" -n 30 --no-pager || true
    die "$SERVICE did not stay up (journal above)"
  fi
}

# Resume check with RELEASE while the service is stopped; restarts what ran before if it fails.
check_or_restore() {
  local was_running=$2
  if ! life "$1" -- --store "$STORE" --check; then
    if [ "$was_running" = yes ]; then systemctl start "$SERVICE"; fi
    die "$(basename "$1") cannot resume this individual (above). Nothing was changed$([ "$was_running" = yes ] && printf '; the release that was running is running again')."
  fi
}

prune() {
  local keep_current keep_previous d
  keep_current=$(readlink -f "$PREFIX/current")
  keep_previous=$(readlink -f "$PREFIX/previous" 2>/dev/null || true)
  for d in "$PREFIX"/releases/*/; do
    d=${d%/}
    [ "$d" = "$keep_current" ] || [ "$d" = "$keep_previous" ] || rm -rf "$d"
  done
  for d in "$PREFIX"/node-v*/; do
    d=${d%/}
    [ "$d" = "$node_dir" ] || rm -rf "$d"
  done
}

# Stopping also cancels a pending automatic restart, so nothing writes the
# store while it is born or checked. The life commits a last checkpoint.
stop_service() {
  if running; then say "stopping $SERVICE: it commits a last checkpoint and releases its lease"; fi
  systemctl stop "$SERVICE" 2>/dev/null || true
}

check_machine
ensure_node
was_running=no
if running; then was_running=yes; fi

case $action in
  prepare)
    build_release
    say "prepared $release; the running release and individual were not changed"
    exit 0
    ;;
  create)
    if [ -e "$STORE" ] && [ -n "$(ls -A "$STORE")" ]; then
      die "$STORE already holds an individual; one store holds one. To start another,
  stop $SERVICE and move the store aside (keep it), then run --create again."
    fi
    build_release
    stop_service
    if [ "$trial" = yes ]; then trial_life; fi
    say "birth: a new individual in $STORE"
    life "$release" -- --store "$STORE" --create ${controller:+--controller "$controller"}
    ;;
  upgrade)
    [ -f "$STORE/individual.json" ] || die "no individual in $STORE: pass --create to give one a
  birth, or restore a backup there first (docs/BETHESDA_CONTINUOUS_LIFE.md)"
    build_release
    stop_service
    if [ "$trial" = yes ]; then trial_life; fi
    say "check: can $commit resume this individual? (every seal and link, then the head restored)"
    check_or_restore "$release" "$was_running"
    ;;
  rollback)
    release=$(readlink -f "$PREFIX/previous" 2>/dev/null || true)
    [ -n "$release" ] && [ -d "$release" ] || die "there is no previous release to go back to"
    [ -f "$STORE/individual.json" ] || die "no individual in $STORE"
    stop_service
    say "check: can $(basename "$release") resume this individual?"
    check_or_restore "$release" "$was_running"
    ;;
esac

switch_to "$release"
prune
start_and_watch
