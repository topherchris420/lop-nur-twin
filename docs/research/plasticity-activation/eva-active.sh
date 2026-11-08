#!/usr/bin/env bash
# Eva: embodied plasticity shadow -> active (lop-nur-twin docs/EVA_ECHO_ACTIVATION.md),
# owner-approved on 2026-11-07. Changes only her systemd setting and restarts her.
# If she is not healthy, or the plasticity does not report active and ok, it puts the
# shadow setting back and restarts her again. Her database is never touched.
set -euo pipefail
CONF=/etc/systemd/system/bethesda-fly.service.d/plasticity.conf
STATE=http://127.0.0.1:8765/state
cd /opt/bethesda-fly
sha256sum --check --strict <<EOF
a942234b2e6578818b76b5e8ec44562de1900dbe698443e9303de2852d50ca56  /opt/bethesda-fly/server.py
613fd429bb953708428d78921c999b1297660b665e6cb171613adcbec7ce5f79  /opt/bethesda-fly/eva_plasticity.py
EOF
grep -qx 'Environment=EVA_PLASTICITY=shadow' "$CONF" || { echo "her setting is not shadow: nothing changed"; exit 1; }
read_state() {
  curl -sf --max-time 5 "$STATE" | python3 -c 'import json,sys; s=json.load(sys.stdin); a=s.get("adaptive") or {}; print(s["life_id"], s["born_at"], s["ticks"], a.get("mode"), a.get("status"), a.get("samples"), a.get("overrides"))'
}
before=$(read_state)
echo "before: $before"
put() {
  printf '[Service]\nEnvironment=EVA_PLASTICITY=%s\n' "$1" | sudo tee "$CONF" >/dev/null
  sudo systemctl daemon-reload
  echo "restarting bethesda-fly ($1) at $(date -u +%FT%TZ)"
  sudo systemctl restart bethesda-fly
  for _ in $(seq 1 20); do
    sleep 2
    if curl -sf --max-time 3 http://127.0.0.1:8765/health >/dev/null; then return 0; fi
  done
  return 1
}
back() {
  echo "$1: putting shadow back"
  put shadow || echo "her service is not answering after the shadow restart either: look now"
  echo "after: $(read_state || echo 'no state')"
  exit 1
}
put active || back "her service did not come back healthy"
after=$(read_state) || back "no state"
echo "after: $after"
read -r l0 b0 t0 _ <<<"$before"
read -r l1 b1 t1 mode status _ <<<"$after"
[ "$l1" = "$l0" ] && [ "$b1" = "$b0" ] || back "not the same life"
python3 -c "import sys; sys.exit(0 if float('$t1') >= float('$t0') else 1)" || back "her clock went back"
[ "$mode" = active ] && [ "$status" = ok ] || back "plasticity reports $mode, $status"
echo "Eva: active, ok, same life, at $(date -u +%FT%TZ)"
