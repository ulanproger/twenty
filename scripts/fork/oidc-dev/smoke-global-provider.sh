#!/usr/bin/env bash
# Drives the platform-wide OIDC provider (OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET) with curl.
#
#   bash scripts/fork/oidc-dev/smoke-global-provider.sh
#
# Needs the dev seed (workspaces apple and yc), the mock IdP from docker-compose.yml and a server started
# with IS_MULTIWORKSPACE_ENABLED=true, NODE_ENV=development, OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS=localhost
# and OIDC_ISSUER=http://localhost:8085/idp-a, OIDC_CLIENT_ID=twenty, OIDC_CLIENT_SECRET=secret.
set -u

SERVER_URL=${SERVER_URL:-http://localhost:3000}
IDP_URL=${IDP_URL:-http://localhost:8085/idp-a}
ORIGIN_A=${ORIGIN_A:-http://apple.localhost:3001}
ORIGIN_B=${ORIGIN_B:-http://yc.localhost:3001}
EMAIL_A=${EMAIL_A:-aaron.munoz185@apple.dev}
# EMAIL_A must be a member of workspace A only, EMAIL_B a member of workspace B.
EMAIL_B=${EMAIL_B:-jane.austen@apple.dev}
# Same value as OIDC_GLOBAL_PROVIDER_ID in oidc-sso/constants/oidc-global-provider-id.constant.ts
GLOBAL_ID=00000000-0000-4000-8000-000000000001

failures=0
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

check() {
  local name=$1 condition=$2
  if eval "$condition"; then echo "PASS  $name"; else echo "FAIL  $name"; failures=$((failures + 1)); fi
}

public_providers() {
  curl -s "$SERVER_URL/metadata" -H 'content-type: application/json' \
    -d "{\"query\":\"{publicOidcProviders(origin:\\\"$1\\\"){id name loginUrl}}\"}"
}

# Prints the first loginUrl, or nothing.
login_url_for() {
  public_providers "$1" | python3 -c "
import json, sys
try:
    print(json.load(sys.stdin)['data']['publicOidcProviders'][0]['loginUrl'])
except Exception:
    print('')"
}

# sign_in <login url> <email>: prints where the callback redirects to.
sign_in() {
  local login_url=$1 email=$2 authorization_url callback_url
  : >"$JAR"
  authorization_url=$(curl -s -c "$JAR" -b "$JAR" -o /dev/null -w '%{redirect_url}' "$login_url")

  case $authorization_url in
    "$IDP_URL"/*) ;;
    *) echo "$authorization_url"; return ;;
  esac

  callback_url=$(curl -s -o /dev/null -w '%{redirect_url}' \
    --data-urlencode "username=smoke-user" \
    --data-urlencode "claims={\"email\":\"$email\",\"email_verified\":true}" "$authorization_url")
  curl -s -c "$JAR" -b "$JAR" -o /dev/null -w '%{redirect_url}' "$callback_url"
}

expect_login() {
  case $2 in
    *"/verify?loginToken="*) echo "PASS  $1 ($(echo "$2" | cut -d/ -f1-3))" ;;
    *) echo "FAIL  $1 (got: ${2:0:140})"; failures=$((failures + 1)) ;;
  esac
}

expect_rejected() {
  case $2 in
    *"/verify?errorMessage="*) echo "PASS  $1" ;;
    *) echo "FAIL  $1 (got: ${2:0:140})"; failures=$((failures + 1)) ;;
  esac
}

URL_A=$(login_url_for "$ORIGIN_A")
URL_B=$(login_url_for "$ORIGIN_B")

check "workspace A is offered only the global provider" \
  '[ "$(public_providers "$ORIGIN_A" | python3 -c "import json,sys; d=json.load(sys.stdin)[\"data\"][\"publicOidcProviders\"]; print(len(d), d[0][\"id\"])")" = "1 $GLOBAL_ID" ]'
check "workspace B is offered the same provider" \
  '[ "$(public_providers "$ORIGIN_B" | python3 -c "import json,sys; d=json.load(sys.stdin)[\"data\"][\"publicOidcProviders\"]; print(len(d), d[0][\"id\"])")" = "1 $GLOBAL_ID" ]'
check "the login urls carry different workspace ids" \
  '[ -n "$URL_A" ] && [ -n "$URL_B" ] && [ "$URL_A" != "$URL_B" ] && [[ "$URL_A" == *"?workspaceId="* ]] && [[ "$URL_B" == *"?workspaceId="* ]]'
check "an unknown origin gets no provider" \
  '[ "$(public_providers "http://nobody.localhost:3001" | python3 -c "import json,sys; print(len(json.load(sys.stdin)[\"data\"][\"publicOidcProviders\"]))")" = "0" ]'

expect_login "member of A signs in through A" "$(sign_in "$URL_A" "$EMAIL_A")"
expect_login "member of B signs in through B" "$(sign_in "$URL_B" "$EMAIL_B")"
expect_rejected "member of A gets no access to B without an invite" "$(sign_in "$URL_B" "$EMAIL_A")"
expect_rejected "a stranger gets no access without an invite" "$(sign_in "$URL_A" "stranger-$$@example.com")"
expect_rejected "global login without a workspace id" "$(sign_in "$SERVER_URL/auth/oidc-sso/login/$GLOBAL_ID" "$EMAIL_A")"
expect_rejected "global login with a malformed workspace id" \
  "$(sign_in "$SERVER_URL/auth/oidc-sso/login/$GLOBAL_ID?workspaceId=not-a-uuid" "$EMAIL_A")"
expect_rejected "global login with an unknown workspace id" \
  "$(sign_in "$SERVER_URL/auth/oidc-sso/login/$GLOBAL_ID?workspaceId=00000000-0000-4000-8000-0000000000ff" "$EMAIL_A")"

if [ "$failures" -gt 0 ]; then
  echo "$failures scenario(s) failed"
  exit 1
fi

echo "all scenarios passed"
