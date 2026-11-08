#!/usr/bin/env bash
# Eva: embodied plasticity in shadow mode (lop-nur-twin docs/EVA_ECHO_ACTIVATION.md, V5 and V6).
# Refuses unless every file is exactly what was tested. If her service does not come
# back healthy, puts her original server back and restarts it.
set -euo pipefail
S=/tmp/eva-plasticity-f18ebb2
cd /opt/bethesda-fly
sha256sum --check --strict <<EOF
a942234b2e6578818b76b5e8ec44562de1900dbe698443e9303de2852d50ca56  $S/server.py
613fd429bb953708428d78921c999b1297660b665e6cb171613adcbec7ce5f79  $S/eva_plasticity.py
c110ccc8d9028be2446ade496c73d4bf3b08d706d1be26230f3e0f6abb41c18a  /opt/bethesda-fly/server.py
EOF
[ -e server.py.original-c110ccc8 ] || sudo cp -p server.py server.py.original-c110ccc8
sudo install -m 0644 -o root -g root "$S/server.py" server.py
sudo install -m 0644 -o root -g root "$S/eva_plasticity.py" eva_plasticity.py
sudo mkdir -p /etc/systemd/system/bethesda-fly.service.d
printf '[Service]\nEnvironment=EVA_PLASTICITY=shadow\n' | sudo tee /etc/systemd/system/bethesda-fly.service.d/plasticity.conf >/dev/null
sudo systemctl daemon-reload
echo "restarting bethesda-fly at $(date -u +%FT%TZ)"
sudo systemctl restart bethesda-fly
ok=0
for _ in $(seq 1 20); do
  sleep 2
  if curl -sf --max-time 3 http://127.0.0.1:8765/health >/dev/null; then ok=1; break; fi
done
if [ "$ok" != 1 ]; then
  echo "her service did not come back healthy: restoring her original server"
  sudo install -m 0644 -o root -g root server.py.original-c110ccc8 server.py
  sudo rm -f /etc/systemd/system/bethesda-fly.service.d/plasticity.conf
  sudo systemctl daemon-reload
  sudo systemctl restart bethesda-fly
  exit 1
fi
echo "healthy at $(date -u +%FT%TZ)"
curl -s --max-time 5 http://127.0.0.1:8765/state | python3 -c 'import json,sys; s=json.load(sys.stdin); a=s.get("adaptive") or {}; print(s["life_id"], s["born_at"], s["ticks"], a.get("mode"), a.get("status"))'
