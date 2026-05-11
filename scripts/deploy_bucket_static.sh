#!/usr/bin/env bash
# Deploy static site files to Yandex Object Storage (prod bucket www.looklab-ai.ru by default).
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
BUCKET="${BUCKET:-www.looklab-ai.ru}"
DRY_RUN="${DRY_RUN:-}"

FILES=(
  "index.html|frontend/index.html"
  "try.html|frontend/try.html"
  "demo.html|frontend/demo.html"
  "style.css|frontend/style.css"
  "script.js|frontend/script.js"
  "body-scan/bodyScanCore.js|frontend/body-scan/bodyScanCore.js"
  "landing.css|frontend/landing.css"
  "request-form.js|frontend/request-form.js"
  "assets/models/female_advanced.glb|frontend/assets/models/female_advanced.glb"
  "assets/models/male_advanced.glb|frontend/assets/models/male_advanced.glb"
  "VirtualTryOn/virtual-try-on.html|frontend/VirtualTryOn/virtual-try-on.html"
  "VirtualTryOn/virtualTryOn.js|frontend/VirtualTryOn/virtualTryOn.js"
  "VirtualTryOn/virtualTryOn.css|frontend/VirtualTryOn/virtualTryOn.css"
  "VirtualTryOn/assets/onboarding/hanger.png|frontend/VirtualTryOn/assets/onboarding/hanger.png"
  "VirtualTryOn/assets/onboarding/person.png|frontend/VirtualTryOn/assets/onboarding/person.png"
  "VirtualTryOn/assets/onboarding/sparkles.png|frontend/VirtualTryOn/assets/onboarding/sparkles.png"
  "VirtualTryOn/catalog/categories.js|frontend/VirtualTryOn/catalog/categories.js"
  "ui/messages.js|frontend/ui/messages.js"
  "ui/messages.css|frontend/ui/messages.css"
)

content_type_for() {
  case "${1##*.}" in
    html) echo "text/html; charset=utf-8" ;;
    css)  echo "text/css; charset=utf-8" ;;
    js)   echo "application/javascript; charset=utf-8" ;;
    glb)  echo "model/gltf-binary" ;;
    png)  echo "image/png" ;;
    *)    echo "application/octet-stream" ;;
  esac
}

blocked_bucket_key() {
  local key="$1"
  [[ "$key" == catalog/* ]]
}

upload_one() {
  local key="$1"
  local path="$2"
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
  local entry
  for entry in "${FILES[@]}"; do
    local key="${entry%%|*}"
    local rel="${entry#*|}"
    upload_one "$key" "$ROOT/$rel"
  done
  echo "Done: ${#FILES[@]} object(s) -> s3://${BUCKET}/"
}

main "$@"
