#!/usr/bin/env bash
# Prepares a checkout of the release that made a backup, so that anyone can
# re-derive the deployed life's checkpoints on their own machine
# (scripts/bethesda-life-replay.ts). It changes nothing on the VM and needs no
# access to it. Run it from a full clone of this repository, on main.
#
#   deploy/bethesda-life/replay-release.sh COMMIT DIR
#
# COMMIT is the full commit that /v1/backup names as `release`; an archive's
# name holds its first 12 digits. Only a commit on main is accepted, because
# the commit comes from a machine this script does not trust: GitHub serves
# commits from forks through this repository's own URL.
#
# The checkout gets the replay's two files from this one, since the release
# predates them, and that release's production dependencies, installed as the
# VM installed them. It prints the Node version the release pinned: the replay
# is only meaningful under that version, on that CPU architecture.
set -Eeuo pipefail

die() {
  printf 'replay-release.sh: %s\n' "$1" >&2
  exit 2
}
[ $# -eq 2 ] || die "usage: replay-release.sh COMMIT DIR"
commit=$1 dir=$2
[[ $commit =~ ^[0-9a-f]{40}$ ]] || die "COMMIT must be 40 hex digits, not '$commit'"
git rev-parse --verify --quiet "origin/main^{commit}" >/dev/null ||
  die "no origin/main here: run it from a full clone"
git merge-base --is-ancestor "$commit" origin/main ||
  die "$commit is not on main: a release is always a commit on main"
[ ! -e "$dir" ] || die "$dir already exists"

here=$(git rev-parse --show-toplevel)
git worktree add --quiet --detach "$dir" "$commit"
cp "$here/scripts/bethesda-life-replay.ts" "$dir/scripts/bethesda-life-replay.ts"
cp "$here/src/bethesda/life/replay.ts" "$dir/src/bethesda/life/replay.ts"
(cd "$dir" && PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev --ignore-scripts --no-audit \
  --no-fund --loglevel=error)
sed -n 's/^NODE_VERSION=//p' "$dir/deploy/bethesda-life/install.sh"
