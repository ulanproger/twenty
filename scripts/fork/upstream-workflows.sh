#!/bin/bash
# Turns the upstream workflows of the fork off and on in GitHub, without editing .github/.
# A workflow is touched when its `on:` block lists any event other than workflow_dispatch and
# workflow_call (those never run by themselves). What cannot be understood is treated as
# automatic, so a surprise never stays enabled. The workflows in KEEP are never touched.
# The workflow files are read from the local checkout, so run it on an up-to-date default branch.
#
# Usage: upstream-workflows.sh status|disable|enable [--dry-run]
#        upstream-workflows.sh events FILE      print the events found in the `on:` block of a file
#   status   list the touched workflows with their state; exit 1 if any is still enabled
#   disable  disable every enabled one
#   enable   enable every one disabled manually or by GitHub for inactivity (it cannot tell
#            what this script disabled from what was disabled by hand)
# Environment: REPO=owner/name (default: the origin remote; the upstream repository is refused).
# Run `status` after every upstream sync: new upstream workflows arrive enabled.
set -euo pipefail

KEEP=(".github/workflows/fork-build-ghcr-image.yaml")
MANUAL_EVENTS=" workflow_dispatch workflow_call "

# Prints one event name per line from the top-level `on:` block (block, list and inline forms).
# An inline mapping `on: { ... }` is not parsed and reported as ?unparsable.
read -r -d '' AWK_EVENTS <<'AWK' || true
function trim(s) { gsub(/^[ \t\r]+|[ \t\r]+$/, "", s); return s }
function unquote(s) { gsub("^[\"" Q "]|[\"" Q "]$", "", s); return s }
function strip_comment(s) { sub(/[ \t]#.*$/, "", s); return s }
BEGIN { Q = sprintf("%c", 39) }
$0 ~ ("^(on|\"on\"|" Q "on" Q "):") {
  rest = strip_comment($0); sub(/^[^:]*:/, "", rest); rest = trim(rest)
  in_on = 1; child_indent = -1
  if (rest != "") {
    in_on = 0
    if (rest ~ /^\[/) {
      gsub(/[\[\]]/, "", rest); n = split(rest, parts, ",")
      for (i = 1; i <= n; i++) print unquote(trim(parts[i]))
    } else if (rest ~ /^\{/) {
      print "?unparsable"
    } else {
      print unquote(rest)
    }
  }
  next
}
in_on {
  line = $0; sub(/\r$/, "", line)
  if (line ~ /^[ \t]*(#.*)?$/) next
  match(line, /^[ \t]*/); indent = RLENGTH
  if (indent == 0) { in_on = 0; next }
  if (child_indent < 0) child_indent = indent
  if (indent != child_indent) next
  item = trim(strip_comment(line))
  if (item ~ /^- /) { sub(/^- /, "", item); print unquote(trim(item)); next }
  sub(/:.*$/, "", item); print unquote(trim(item))
}
AWK

fail() { echo "ERROR: $*" >&2; exit 1; }
warn() { echo "warning: $*" >&2; }
usage() { echo "Usage: $0 status|disable|enable [--dry-run] | events FILE" >&2; exit 2; }

if [ "${1:-}" = "events" ]; then
  [ $# -eq 2 ] && [ -f "$2" ] || usage
  awk "$AWK_EVENTS" "$2"
  exit 0
fi

mode=""
dry_run=0
for arg in "$@"; do
  case "$arg" in
    status | disable | enable) [ -z "$mode" ] || usage; mode="$arg" ;;
    --dry-run) dry_run=1 ;;
    *) usage ;;
  esac
done
[ -n "$mode" ] || usage

cd "$(git rev-parse --show-toplevel)" || fail "run this from inside a git checkout"
command -v gh >/dev/null || fail "the GitHub CLI (gh) is not installed"
gh auth status >/dev/null 2>&1 || fail "gh is not logged in (gh auth login)"

if [ -z "${REPO:-}" ]; then
  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  REPO="$(printf '%s' "$origin_url" | sed -E 's#^(git@|ssh://git@|https://)github\.com[:/]##; s#\.git$##')"
fi
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "could not work out the repository from the origin remote, set REPO=owner/name"
case "$REPO" in
  twentyhq/*) fail "refusing to touch the upstream repository $REPO" ;;
esac

is_kept() {
  local wfpath="$1" kept
  for kept in "${KEEP[@]}"; do
    [ "$wfpath" = "$kept" ] && return 0
  done
  return 1
}

# Returns 0 when the workflow can start on its own, also when that cannot be told.
has_auto_trigger() {
  local file="$1" events event
  [ -f "$file" ] || return 0
  events="$(awk "$AWK_EVENTS" "$file")"
  [ -n "$events" ] || return 0
  while IFS= read -r event; do
    case "$MANUAL_EVENTS" in
      *" $event "*) ;;
      *) return 0 ;;
    esac
  done <<< "$events"
  return 1
}

workflow_list="$(gh api "repos/$REPO/actions/workflows" --paginate --jq '.workflows[] | [.id, .state, .path] | join("|")')" \
  || fail "could not list the workflows of $REPO"
[ -n "$workflow_list" ] || fail "GitHub returned no workflows for $REPO, refusing to report anything"

echo "repository: $REPO"

enabled=0
not_enabled=0
changed=0
failures=0

while IFS='|' read -r id state wfpath; do
  if ! [[ "$id" =~ ^[0-9]+$ ]] || [ -z "$wfpath" ]; then
    warn "skipping a malformed entry from GitHub: '$id|$state|$wfpath'"
    continue
  fi

  is_kept "$wfpath" && continue
  has_auto_trigger "$wfpath" || continue

  note=""
  [ -f "$wfpath" ] || note="  (no such file in this checkout, treated as automatic)"

  case "$state" in
    active) enabled=$((enabled + 1)) ;;
    *) not_enabled=$((not_enabled + 1)) ;;
  esac

  action=""
  if [ "$mode" = "disable" ] && [ "$state" = "active" ]; then
    action="disable"
  elif [ "$mode" = "enable" ] && { [ "$state" = "disabled_manually" ] || [ "$state" = "disabled_inactivity" ]; }; then
    action="enable"
  fi

  if [ "$mode" = "status" ]; then
    printf '%-20s %s%s\n' "$state" "$(basename "$wfpath")" "$note"
  elif [ "$mode" = "enable" ] && [ -z "$action" ] && [ "$state" != "active" ]; then
    printf 'skipped (%s) %s\n' "$state" "$(basename "$wfpath")"
  elif [ -n "$action" ]; then
    if [ "$dry_run" = "1" ]; then
      printf 'would %s %s%s\n' "$action" "$(basename "$wfpath")" "$note"
      changed=$((changed + 1))
    elif gh api -X PUT "repos/$REPO/actions/workflows/$id/$action" --silent; then
      printf '%sd %s%s\n' "$action" "$(basename "$wfpath")" "$note"
      changed=$((changed + 1))
    else
      printf 'FAILED to %s %s\n' "$action" "$(basename "$wfpath")" >&2
      failures=$((failures + 1))
    fi
  fi
done <<< "$workflow_list"

echo "Workflows that can start on their own: $enabled enabled, $not_enabled not enabled; changed: $changed; failed: $failures"

[ "$failures" -eq 0 ] || exit 1
[ "$mode" = "status" ] && [ "$enabled" -gt 0 ] && exit 1
exit 0
