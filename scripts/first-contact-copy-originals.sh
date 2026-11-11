#!/usr/bin/env bash
# Copies of both originals, for docs/FIRST_CONTACT.md Stage 4 (step 2,
# "Backups and provenance"), made without changing either life. The owner
# runs it; nothing in a session may. Afterwards, check the copies with
#   python -I scripts/eva-restore-check.py <snapshot> <sidecar> --expect-life <Eva's id>
# and, from a clean checkout of the release the archive names,
#   node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --store <unpacked>/store --check
#
# What it does on the two VMs, and nothing else:
#
#   Eva (GARDEN_SSH)
#     1. reads where her service keeps its database and plasticity sidecar
#        (systemctl show bethesda-fly.service);
#     2. reads her sidecar and its daily copies with sudo cat, each hashed on
#        the VM from the same bytes it sends;
#     3. THEN takes her database snapshot with the garden's own tool,
#        `node deploy/garden/deploy.mjs backup`. That starts
#        bethesda-fly-backup.service, which writes one consistent SQLite copy
#        into her weekly slot (the step every garden deploy takes first), and
#        copies her slots here. The sidecar is read first because her
#        extension refuses a sidecar that has learned past her database's tick.
#
#   ECHO (LIFE_SSH)
#     4. reads the newest archive its own backup.sh kept (named by the
#        witness's public /v1/backup; backup.sh unpacked and checked it on the
#        VM before keeping it), and its .sha256. Nothing on that VM is started
#        or written.
#
# Environment (credentials never come from the repository):
#   GARDEN_SSH, GARDEN_SSH_KEY, GARDEN_KNOWN_HOSTS   as for deploy/garden/deploy.mjs
#   LIFE_SSH            user@host of ECHO's VM
#   LIFE_WITNESS        ECHO's public witness origin (https://...)
#   LIFE_SSH_KEY        default GARDEN_SSH_KEY
#   LIFE_KNOWN_HOSTS    default ~/.ssh/known_hosts (the host key must be in it)
#   COPIES_DIR          where the copies go: outside the repository
#   PYTHON              default python3, else python
#
# The originals' identities are the ones src/bethesda/firstContact/originals.ts
# records; a copy of anything else stops the run. Nothing is uploaded.
set -Eeuo pipefail
export LC_ALL=C

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
EVA_LIFE=5cf42cd6-fd0a-474d-882c-4cb70e0357e8
ECHO_INDIVIDUAL=04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921

die() { printf 'first-contact-copy-originals: %s\n' "$*" >&2; exit 1; }
say() { printf 'first-contact-copy-originals: %s\n' "$*"; }
need() { [ -n "${!1:-}" ] || die "set $1 (see the header)"; }

for v in GARDEN_SSH GARDEN_SSH_KEY GARDEN_KNOWN_HOSTS LIFE_SSH LIFE_WITNESS COPIES_DIR; do need "$v"; done
LIFE_SSH_KEY=${LIFE_SSH_KEY:-$GARDEN_SSH_KEY}
# On Windows, python3 may be the Microsoft Store's placeholder; try python too.
if [ -z "${PYTHON:-}" ]; then
  for p in python3 python; do "$p" -c 'import json' >/dev/null 2>&1 && PYTHON=$p && break; done
fi
[ -n "${PYTHON:-}" ] || die "no Python found: set PYTHON"
LIFE_KNOWN_HOSTS=${LIFE_KNOWN_HOSTS:-$HOME/.ssh/known_hosts}
mkdir -p "$COPIES_DIR"
COPIES_DIR=$(cd "$COPIES_DIR" && pwd)
case $COPIES_DIR/ in "$REPO"/*) die "COPIES_DIR must be outside the repository: the lives are not committed" ;; esac
grep -q "$EVA_LIFE" "$REPO/src/bethesda/firstContact/originals.ts" &&
  grep -q "$ECHO_INDIVIDUAL" "$REPO/src/bethesda/firstContact/originals.ts" ||
  die "these identities are not the ones originals.ts records"

OUT=$COPIES_DIR/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$OUT/eva/sidecar" "$OUT/echo"
say "copies go to $OUT"

ssh_eva() {
  ssh -i "$GARDEN_SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$GARDEN_KNOWN_HOSTS" "$GARDEN_SSH" "$@"
}
ssh_echo() {
  ssh -i "$LIFE_SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$LIFE_KNOWN_HOSTS" "$LIFE_SSH" "$@"
}

# fetch HOST-FUNCTION REMOTE-FILE LOCAL-FILE: one read, hashed on the VM from
# the bytes it sends, compared with the bytes that arrived.
fetch() {
  local via=$1 src=$2 dst=$3 remote here
  case $src in *\'*) die "refusing a path with a quote: $src" ;; esac
  "$via" "sudo cat -- '$src' | tee >(sha256sum >&2)" >"$dst" 2>"$dst.remote" ||
    die "could not read $src"
  remote=$(grep -Eo '^[0-9a-f]{64}' "$dst.remote" | tail -n 1 || true)
  here=$(sha256sum "$dst" | cut -c1-64)
  [ -n "$remote" ] || die "$src: the VM sent no checksum"
  [ "$remote" = "$here" ] || die "$src arrived damaged (VM $remote, here $here)"
  rm -f "$dst.remote"
  say "$(basename "$dst")  $(stat -c %s "$dst") bytes  $here"
}

# ---- Eva: where her service keeps its files
env_line=$(ssh_eva "systemctl show bethesda-fly.service --property=Environment --value") ||
  die "could not read bethesda-fly.service's environment"
printf '%s\n' "$env_line" >"$OUT/eva/service-environment.txt"
value() { printf '%s\n' "$env_line" | tr ' ' '\n' | sed -n "s/^$1=//p" | tail -n 1; }
db=$(value FLY_DB)
db=${db:-/var/lib/bethesda-fly/world.sqlite3}
mode=$(value EVA_PLASTICITY)
sidecar=$(value EVA_PLASTICITY_SIDECAR)
sidecar=${sidecar:-$(dirname "$db")/eva.eva-plasticity-v1.json}
case $sidecar in /var/lib/bethesda-fly/*.eva-plasticity-v1.json) ;; *) die "unexpected sidecar path: $sidecar" ;; esac
[ "$mode" = active ] || [ "$mode" = shadow ] || die "EVA_PLASTICITY is '$mode', not active or shadow"
say "Eva: database $db, sidecar $sidecar, plasticity $mode"

# ---- Eva: the sidecar first, then its daily copies
base=$(basename "$sidecar")
fetch ssh_eva "$sidecar" "$OUT/eva/sidecar/$base"
copies=$(ssh_eva "sudo find '$(dirname "$sidecar")' -maxdepth 1 -name '$base.day-[0-6]' -printf '%f\n'" | sort) ||
  die "could not list the sidecar's daily copies"
for name in $copies; do
  [[ $name =~ ^[a-z0-9.-]+\.day-[0-6]$ ]] || die "unexpected file: $name"
  fetch ssh_eva "$(dirname "$sidecar")/$name" "$OUT/eva/sidecar/$name"
done

# ---- Eva: then her database, with the garden's own backup
say "Eva: taking her database snapshot (bethesda-fly-backup.service)"
(cd "$REPO" && GARDEN_BACKUP_DIR="$OUT/eva" node deploy/garden/deploy.mjs backup) >"$OUT/eva/backup.json" ||
  die "the garden backup failed (above); her sidecar copies are kept in $OUT/eva/sidecar"
grep -q "\"life_id\": \"$EVA_LIFE\"" "$OUT/eva/backup.json" || die "the snapshot is not Eva's life"

# ---- ECHO: the newest archive backup.sh kept and checked
curl -fsS --max-time 30 "$LIFE_WITNESS/v1/backup" >"$OUT/echo/status.json" ||
  die "could not read $LIFE_WITNESS/v1/backup"
# tr: Python on Windows ends its lines with CRLF.
read -r name want who < <("$PYTHON" -I -c 'import json,sys
k=json.load(open(sys.argv[1]))["kept"]
print(k["archive"], k["sha256"], k["individual"])' "$OUT/echo/status.json" | tr -d '\r') ||
  die "status.json names no kept archive"
[[ $name =~ ^bethesda-life-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}\.tar\.gz$ ]] || die "unexpected archive name: $name"
[ "$who" = "$ECHO_INDIVIDUAL" ] || die "the kept archive is not ECHO's individual"
fetch ssh_echo "/var/backups/bethesda-life/$name" "$OUT/echo/$name"
fetch ssh_echo "/var/backups/bethesda-life/$name.sha256" "$OUT/echo/$name.sha256"
[ "$(sha256sum "$OUT/echo/$name" | cut -c1-64)" = "$want" ] || die "$name does not match the SHA-256 backup.sh recorded"
[ "$(cut -c1-64 "$OUT/echo/$name.sha256")" = "$want" ] || die "$name.sha256 does not match status.json"

(cd "$OUT" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum) >"$OUT/MANIFEST.sha256"
say "done: $OUT"
