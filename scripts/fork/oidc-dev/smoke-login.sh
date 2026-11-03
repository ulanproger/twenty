#!/usr/bin/env bash
# Drives the OIDC login flow with curl against a running Twenty server and the mock IdP.
#
#   PROVIDER_ID=<uuid of an active provider on the idp-a issuer> \
#     bash scripts/fork/oidc-dev/smoke-login.sh
#
# Needs the dev seed (workspace "apple" with its users and invite hash), the server started with
# OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS=localhost and the mock IdP from docker-compose.yml.
# The inactive-provider scenario edits the provider row through the dev Postgres container.
set -u

: "${PROVIDER_ID:?set PROVIDER_ID to the id of an active OIDC provider}"
SERVER_URL=${SERVER_URL:-http://localhost:3000}
IDP_URL=${IDP_URL:-http://localhost:8085/idp-a}
DB_CONTAINER=${DB_CONTAINER:-twenty-dev-db-1}
SAME_WORKSPACE_INVITE=${SAME_WORKSPACE_INVITE:-apple.dev-invite-hash}
OTHER_WORKSPACE_INVITE=${OTHER_WORKSPACE_INVITE:-yc.dev-invite-hash}
EXISTING_EMAIL=${EXISTING_EMAIL:-aaron.munoz185@apple.dev}

failures=0
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

# Prints the URL the callback redirects to; CALLBACK_URL keeps the URL sent to the server.
sign_in() {
  local claims=$1 query=${2:-} provider_id=${3:-$PROVIDER_ID}
  : >"$JAR"

  local authorization_url
  authorization_url=$(curl -s -c "$JAR" -b "$JAR" -o /dev/null -w '%{redirect_url}' \
    "$SERVER_URL/auth/oidc-sso/login/$provider_id$query")

  case $authorization_url in
    "$IDP_URL"/*) ;;
    *)
      CALLBACK_URL=
      echo "$authorization_url"
      return
      ;;
  esac

  CALLBACK_URL=$(curl -s -o /dev/null -w '%{redirect_url}' \
    --data-urlencode "username=smoke-user" --data-urlencode "claims=$claims" "$authorization_url")

  call_callback "$CALLBACK_URL"
}

call_callback() {
  curl -s -c "$JAR" -b "$JAR" -o /dev/null -w '%{redirect_url}' "$1"
}

# A scenario that needs a callback URL must not pass on an empty one.
require_callback_url() {
  if [ -z "$CALLBACK_URL" ]; then
    echo "FAIL  $1 (login did not reach the IdP, nothing to replay)"
    failures=$((failures + 1))
    return 1
  fi
}

expect_login() {
  local name=$1 result=$2
  case $result in
    *"/verify?loginToken="*) echo "PASS  $name" ;;
    *) echo "FAIL  $name (expected a login token, got: ${result:0:120})"; failures=$((failures + 1)) ;;
  esac
}

expect_rejected() {
  local name=$1 result=$2
  case $result in
    *"/verify?errorMessage="*) echo "PASS  $name" ;;
    *) echo "FAIL  $name (expected an error redirect, got: ${result:0:120})"; failures=$((failures + 1)) ;;
  esac
}

set_provider_status() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d default -qAtc \
    "UPDATE core.\"workspaceOidcProvider\" SET status = '$1' WHERE id = '$PROVIDER_ID'" >/dev/null
}

# The sign-in only accepts an email the IdP marks as verified, so this always adds
# email_verified:true. The negative cases below are written out for that reason.
claims_for() { printf '{"email":"%s","email_verified":true%s}' "$1" "${2:+,$2}"; }

EXISTING_CLAIMS=$(claims_for "$EXISTING_EMAIL" '"given_name":"Aaron"')
VALID_CLAIMS=$(claims_for "$EXISTING_EMAIL")
NO_FLAG_CLAIMS=$(printf '{"email":"%s"}' "$EXISTING_EMAIL")
UNVERIFIED_CLAIMS=$(printf '{"email":"%s","email_verified":false}' "$EXISTING_EMAIL")
UNVERIFIED_STRING_CLAIMS=$(printf '{"email":"%s","email_verified":"false"}' "$EXISTING_EMAIL")
UPN_CLAIMS=$(printf '{"upn":"%s"}' "$EXISTING_EMAIL")
STRANGER_CLAIMS=$(claims_for "stranger-$$@example.com")
INVITED_CLAIMS=$(claims_for "invited-$$@example.com" '"given_name":"Invited"')

expect_login "existing user signs in" "$(sign_in "$EXISTING_CLAIMS")"
expect_rejected "upn alone is not an email" "$(sign_in "$UPN_CLAIMS")"
expect_rejected "email without email_verified is rejected" "$(sign_in "$NO_FLAG_CLAIMS")"
expect_rejected "email_verified false is rejected" "$(sign_in "$UNVERIFIED_CLAIMS")"
expect_rejected "email_verified \"false\" is rejected" "$(sign_in "$UNVERIFIED_STRING_CLAIMS")"
expect_rejected "no email" "$(sign_in '{"given_name":"Nobody"}')"
expect_rejected "malformed email" "$(sign_in '{"email":"not-an-email","email_verified":true}')"
expect_rejected "new user without an invite" "$(sign_in "$STRANGER_CLAIMS")"
expect_login "new user with the workspace invite hash" \
  "$(sign_in "$INVITED_CLAIMS" "?workspaceInviteHash=$SAME_WORKSPACE_INVITE")"
expect_rejected "invite hash of another workspace" \
  "$(sign_in "$VALID_CLAIMS" "?workspaceInviteHash=$OTHER_WORKSPACE_INVITE")"
expect_rejected "unknown provider id" \
  "$(sign_in "$VALID_CLAIMS" "" "00000000-0000-4000-8000-000000000000")"
expect_rejected "malformed provider id" "$(sign_in "$VALID_CLAIMS" "" "not-a-uuid")"

sign_in "$VALID_CLAIMS" >/dev/null
require_callback_url "replayed callback" &&
  expect_rejected "replayed callback" "$(call_callback "$CALLBACK_URL")"

sign_in "$VALID_CLAIMS" >/dev/null
tampered_url=${CALLBACK_URL/state=/state=x}
if require_callback_url "foreign state" && [ "$tampered_url" != "$CALLBACK_URL" ]; then
  expect_rejected "foreign state" "$(call_callback "$tampered_url")"
fi

sign_in "$VALID_CLAIMS" >/dev/null
require_callback_url "callback without the session cookie" &&
  expect_rejected "callback without the session cookie" \
    "$(curl -s -o /dev/null -w '%{redirect_url}' "$CALLBACK_URL")"

set_provider_status inactive
expect_rejected "inactive provider" "$(sign_in "$VALID_CLAIMS")"
set_provider_status active

if [ "$failures" -gt 0 ]; then
  echo "$failures scenario(s) failed"
  exit 1
fi

echo "all scenarios passed"
