#!/bin/bash
# Turns the upstream workflows of the fork off and on in GitHub, without editing .github/.
# Only workflows with an automatic trigger (push, pull_request*, merge_group, schedule,
# workflow_run, issue_comment, issues, release) are touched. Manual-only and
# workflow_call-only files never run by themselves, and KEEP is never touched.
#
# Usage: upstream-workflows.sh status|disable|enable [--dry-run]
#   status   list the workflows that would be touched and their state; exit 1 if some are enabled
#   disable  disable every enabled one            enable  enable every one disabled manually
# Run `status` after every upstream sync: new upstream workflows arrive enabled.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

REPO="${REPO:-ulanproger/twenty}"
KEEP=("fork-build-ghcr-image.yaml")
AUTO_TRIGGER='^[[:space:]]*(push|pull_request|pull_request_target|pull_request_review|merge_group|schedule|workflow_run|issue_comment|issues|release):'

mode="${1:-}"
dry_run=0
[ "${2:-}" = "--dry-run" ] && dry_run=1

case "$mode" in
  status | disable | enable) ;;
  *)
    echo "Usage: $0 status|disable|enable [--dry-run]" >&2
    exit 2
    ;;
esac

is_kept() {
  local name="$1" kept
  for kept in "${KEEP[@]}"; do
    [ "$name" = "$kept" ] && return 0
  done
  return 1
}

has_auto_trigger() {
  local file=".github/workflows/$1"
  [ -f "$file" ] && grep -Eq "$AUTO_TRIGGER" "$file"
}

enabled=0
disabled=0
changed=0

while IFS=$'\t' read -r id state path; do
  name="$(basename "$path")"

  is_kept "$name" && continue
  has_auto_trigger "$name" || continue

  case "$state" in
    active) enabled=$((enabled + 1)) ;;
    *) disabled=$((disabled + 1)) ;;
  esac

  action=""
  if [ "$mode" = "disable" ] && [ "$state" = "active" ]; then
    action="disable"
  elif [ "$mode" = "enable" ] && [ "$state" = "disabled_manually" ]; then
    action="enable"
  fi

  if [ "$mode" = "status" ]; then
    printf '%-18s %s\n' "$state" "$name"
  elif [ -n "$action" ]; then
    if [ "$dry_run" = "1" ]; then
      printf 'would %s %s\n' "$action" "$name"
    else
      gh api -X PUT "repos/$REPO/actions/workflows/$id/$action" --silent
      printf '%sd %s\n' "$action" "$name"
    fi
    changed=$((changed + 1))
  fi
done < <(gh api "repos/$REPO/actions/workflows" --paginate --jq '.workflows[] | [.id, .state, .path] | @tsv')

echo "Workflows with an automatic trigger: $enabled enabled, $disabled not enabled; changed: $changed"

[ "$mode" = "status" ] && [ "$enabled" -gt 0 ] && exit 1
exit 0
