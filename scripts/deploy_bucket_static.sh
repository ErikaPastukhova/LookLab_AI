#!/usr/bin/env bash
# Deploy static site files to Yandex Object Storage (bucket onlinemannequin by default).
#
# Run from a machine with `yc` configured. From the monorepo root:
#   git submodule update --init --recursive
#   bash graduation_project_erika_dasha/scripts/deploy_bucket_static.sh
#
# Does not upload keys under catalog/ at bucket root (prod catalog). Paths like
# VirtualTryOn/catalog/categories.js are allowed.
#
# Optional: BUCKET=name DRY_RUN=1

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUCKET="${BUCKET:-onlinemannequin}"
DRY_RUN="${DRY_RUN:-}"

FILES=(
  index.html
  try.html
  demo.html
  style.css
  script.js
  landing.css
  request-form.js
  VirtualTryOn/virtual-try-on.html
  VirtualTryOn/virtualTryOn.js
  VirtualTryOn/virtualTryOn.css
  VirtualTryOn/catalog/categories.js
  ui/messages.js
  ui/messages.css
)

content_type_for() {
  case "${1##*.}" in
    html) echo "text/html; charset=utf-8" ;;
    css)  echo "text/css; charset=utf-8" ;;
    js)   echo "application/javascript; charset=utf-8" ;;
    *)    echo "application/octet-stream" ;;
  esac
}

blocked_bucket_key() {
  local key="$1"
  [[ "$key" == catalog/* ]]
}

upload_one() {
  local key="$1"
  local path="$ROOT/$key"
  local ct
  ct="$(content_type_for "$key")"

  if blocked_bucket_key "$key"; then
    echo "Refusing to upload reserved catalog prefix: $key" >&2
    exit 1
  fi
  if [[ ! -f "$path" ]]; then
    echo "Missing file (update submodule / checkout): $path" >&2
    exit 1
  fi

  if [[ -n "$DRY_RUN" ]]; then
    echo "DRY_RUN: yc storage s3api put-object --bucket $BUCKET --key $key --body $path --content-type $ct"
    return
  fi

  yc storage s3api put-object \
    --bucket "$BUCKET" \
    --key "$key" \
    --body "$path" \
    --content-type "$ct"
}

main() {
  command -v yc >/dev/null 2>&1 || { echo "yc CLI not found" >&2; exit 1; }
  for key in "${FILES[@]}"; do
    upload_one "$key"
  done
  echo "Done: ${#FILES[@]} object(s) -> s3://${BUCKET}/"
}

main "$@"
