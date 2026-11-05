#!/bin/bash
# Fails when the fork touches upstream files outside the allowed seams.
# Usage: check-oidc-seams.sh [--numstat-from -]   (stdin takes "added<TAB>deleted<TAB>path" lines)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

SEAMS_FILE="scripts/fork/oidc-seams.txt"
OWN_PREFIXES=(
  "packages/twenty-server/src/engine/core-modules/oidc-sso/"
  "packages/twenty-front/src/modules/oidc-sso/"
  "scripts/fork/"
)
OWN_FILES=("docs/oidc-sso-roadmap.md" ".github/workflows/fork-build-ghcr-image.yaml")

if [ "${1:-}" = "--numstat-from" ] && [ "${2:-}" = "-" ]; then
  numstat="$(cat)"
else
  base="$(git merge-base upstream/main HEAD)"
  untracked="$(git ls-files -o --exclude-standard | awk '{print "1\t0\t" $0}')"
  numstat="$(git diff --numstat --no-renames "$base")"$'\n'"$untracked"
fi

own=0
seam=0
violations=()

is_own() {
  local path="$1" prefix file
  for prefix in "${OWN_PREFIXES[@]}"; do
    [[ "$path" == "$prefix"* ]] && return 0
  done
  for file in "${OWN_FILES[@]}"; do
    [[ "$path" == "$file" ]] && return 0
  done
  return 1
}

while IFS=$'\t' read -r added deleted path; do
  [ -z "${path:-}" ] && continue

  if is_own "$path"; then
    own=$((own + 1))
  elif grep -Fxq "$path" "$SEAMS_FILE"; then
    if [ "$added" = "-" ] || [ "$deleted" != "0" ]; then
      violations+=("seam must be additive only ($deleted deleted): $path")
    else
      seam=$((seam + 1))
    fi
  else
    violations+=("not allowed: $path")
  fi
done <<< "$numstat"

if [ "${#violations[@]}" -gt 0 ]; then
  printf 'FAIL:\n' >&2
  printf '  %s\n' "${violations[@]}" >&2
  exit 1
fi

echo "OK: $seam seam file(s), $own own file(s)"
