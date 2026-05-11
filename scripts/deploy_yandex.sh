#!/usr/bin/env bash
# Full deploy: static frontend (Object Storage) + FastAPI backend (om-backend VM).
#
# From monorepo root (after submodule checkout):
#   git submodule update --init --recursive
#   bash graduation_project_erika_dasha/scripts/deploy_yandex.sh
#
# Environment:
#   BUCKET              — Object Storage bucket (default: www.looklab-ai.ru prod), passed to deploy_bucket_static.sh
#   OM_BACKEND_SSH      — SSH target (default: ubuntu@111.88.254.136)
#   OM_SSH_IDENTITY     — optional path to private key, e.g. ~/.ssh/id_ed25519
#   DRY_RUN=1           — print actions only (frontend uses existing support; backend prints rsync/ssh)
#
# Flags:
#   --frontend-only     — bucket only
#   --backend-only      — VM only (skip deploy_bucket_static.sh)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OM_BACKEND_SSH="${OM_BACKEND_SSH:-ubuntu@111.88.254.136}"

DO_FRONTEND=1
DO_BACKEND=1

for arg in "$@"; do
  case "$arg" in
    --frontend-only) DO_BACKEND=0 ;;
    --backend-only) DO_FRONTEND=0 ;;
    "")
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--frontend-only|--backend-only]" >&2
      exit 1
      ;;
  esac
done

if [[ "$DO_FRONTEND" -eq 0 && "$DO_BACKEND" -eq 0 ]]; then
  echo "Nothing to do: use at most one of --frontend-only / --backend-only." >&2
  exit 1
fi

ssh_rsh() {
  if [[ -n "${OM_SSH_IDENTITY:-}" ]]; then
    echo "ssh -i ${OM_SSH_IDENTITY} -o BatchMode=yes"
  else
    echo "ssh -o BatchMode=yes"
  fi
}

deploy_frontend() {
  echo "==> Frontend: Object Storage (deploy_bucket_static.sh)"
  bash "$ROOT/scripts/deploy_bucket_static.sh"
}

deploy_backend() {
  echo "==> Backend: rsync + pip + systemd on $OM_BACKEND_SSH"
  local rsh
  rsh="$(ssh_rsh)"
  export RSYNC_RSH="$rsh"

  local src="$ROOT/backend/"
  if [[ ! -d "$src" ]]; then
    echo "Missing backend directory: $src" >&2
    exit 1
  fi

  if [[ -n "${DRY_RUN:-}" ]]; then
    echo "DRY_RUN: rsync -avz --exclude 'storage_data/' --exclude '__pycache__/' --exclude '*.pyc' --exclude '.venv/' --exclude '.env' -e \"$rsh\" \"$src\" \"$OM_BACKEND_SSH:/tmp/om-backend-src/\""
    echo "DRY_RUN: $rsh $OM_BACKEND_SSH 'sudo rsync -a /tmp/om-backend-src/ /home/daryohas/backend/ && sudo chown -R daryohas:daryohas /home/daryohas/backend && rm -rf /tmp/om-backend-src && sudo -u daryohas /home/daryohas/venvs/backend/bin/pip install -q -r /home/daryohas/backend/requirements.txt && sudo systemctl restart om-backend && sudo systemctl is-active om-backend'"
    return
  fi

  rsync -avz \
    --exclude 'storage_data/' \
    --exclude '__pycache__/' \
    --exclude '*.pyc' \
    --exclude '.venv/' \
    --exclude '.env' \
    -e "$rsh" \
    "$src" "$OM_BACKEND_SSH:/tmp/om-backend-src/"

  $rsh "$OM_BACKEND_SSH" 'sudo rsync -a /tmp/om-backend-src/ /home/daryohas/backend/ && sudo chown -R daryohas:daryohas /home/daryohas/backend && rm -rf /tmp/om-backend-src && sudo -u daryohas /home/daryohas/venvs/backend/bin/pip install -q -r /home/daryohas/backend/requirements.txt && sudo systemctl restart om-backend && sudo systemctl is-active om-backend'
}

main() {
  if [[ "$DO_FRONTEND" -eq 1 ]]; then
    deploy_frontend
  fi
  if [[ "$DO_BACKEND" -eq 1 ]]; then
    deploy_backend
  fi
  echo "All requested deploy steps finished."
}

main "$@"
