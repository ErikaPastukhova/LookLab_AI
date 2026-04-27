#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  echo ""
  echo "Stopping..."
  [[ -n "${SSH_PID:-}" ]] && kill "$SSH_PID" 2>/dev/null || true
  [[ -n "${BE_PID:-}"  ]] && kill "$BE_PID"  2>/dev/null || true
  [[ -n "${FE_PID:-}"  ]] && kill "$FE_PID"  2>/dev/null || true
}
trap cleanup INT TERM EXIT

is_port_free() {
  local port="$1"
  python3 - "$port" <<'PY'
import socket, sys
port = int(sys.argv[1])
s = socket.socket()
try:
    s.bind(("127.0.0.1", port))
except OSError:
    sys.exit(1)
finally:
    s.close()
sys.exit(0)
PY
}

pick_free_port() {
  local start="$1"
  local end="$2"
  local p
  for p in $(seq "$start" "$end"); do
    if is_port_free "$p"; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

# 1) SSH tunnel to cloud inference (10.128.0.20:8001) via om-backend VM
ssh -o ExitOnForwardFailure=yes -N -L 8001:10.128.0.20:8001 ubuntu@111.88.254.136 &
SSH_PID=$!

# 2) Backend (FastAPI)
python3 -m venv .venv >/dev/null 2>&1 || true
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install -r backend/requirements.txt >/dev/null
cp backend/.env.example .env
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 &
BE_PID=$!

# 3) Frontend static server
FRONTEND_PORT="$(pick_free_port 5500 5599)"
python3 -m http.server "$FRONTEND_PORT" &
FE_PID=$!

echo "Tunnel:   localhost:8001 -> 10.128.0.20:8001"
echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:${FRONTEND_PORT}/VirtualTryOn/virtual-try-on.html"

wait

