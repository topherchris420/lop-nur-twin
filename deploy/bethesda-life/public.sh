#!/usr/bin/env bash
# Puts the read-only observer on the internet over HTTPS: Caddy, with a
# certificate it obtains from Let's Encrypt and renews, in front of
# bethesda-life-observer on 127.0.0.1:8790. Run it as root on the machine,
# after install.sh.
#
#   sudo deploy/bethesda-life/public.sh HOST      e.g. 129-213-139-78.sslip.io
#
# HOST must resolve to this machine (an sslip.io name does for its address),
# and ports 80 (for the certificate) and 443 must reach it. This script opens
# them in the machine's own firewall; a cloud firewall in front of it (an
# Oracle security list) must allow them as well.
set -euo pipefail

OBSERVER=bethesda-life-observer
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
host=${1:-}

say() { printf '%s\n' "$*"; }
die() {
  printf 'public.sh: %s\n' "$*" >&2
  exit 1
}
[ "$(id -u)" -eq 0 ] || die "run it as root (sudo)"
[[ $host =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && $host == *.* ]] || die "usage: public.sh HOST"
systemctl is-active --quiet "$OBSERVER" || die "$OBSERVER is not running: run install.sh first"

command -v caddy >/dev/null || { apt-get update -qq && apt-get install -y -qq caddy; }
sed "s/^HOST {/$host {/" "$here/Caddyfile" >/etc/caddy/Caddyfile.new
caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null 2>&1 ||
  die "the Caddyfile for $host does not validate: caddy validate --config /etc/caddy/Caddyfile.new"
mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile

# The machine's own firewall. Oracle's Ubuntu images end INPUT with a REJECT:
# the ports go just before it, and are saved for the next boot.
if command -v iptables >/dev/null; then
  for port in 80 443; do
    if ! iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
      at=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
      iptables -I INPUT "${at:-1}" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
      say "firewall: tcp $port accepted"
    fi
  done
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1; fi
fi

systemctl enable --quiet caddy
systemctl reload-or-restart caddy
say "caddy: serving https://$host/v1/now; waiting for its certificate"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "https://$host/v1/health" >/dev/null 2>&1 ||
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$host/v1/health")" = 503 ]; then
    say "public: https://$host/v1/now answers ($(curl -s --max-time 5 "https://$host/v1/health"))"
    exit 0
  fi
  sleep 5
done
journalctl -u caddy -n 20 --no-pager || true
die "https://$host does not answer yet (journal above): check that ports 80 and 443 reach this machine"
