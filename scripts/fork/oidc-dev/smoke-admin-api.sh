#!/usr/bin/env bash
# Drives the OIDC admin and public GraphQL API with curl against a running Twenty server.
#
#   bash scripts/fork/oidc-dev/smoke-admin-api.sh
#
# Needs the dev seed (admin tim@apple.dev, member jony.ive@apple.dev, password = the email of tim),
# the server started with NODE_ENV=development and OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS=localhost,
# and the mock IdP from docker-compose.yml. Creates and deletes its own providers.
set -u

SERVER_URL=${SERVER_URL:-http://localhost:3000}
IDP_URL=${IDP_URL:-http://localhost:8085}
ORIGIN=${ORIGIN:-http://localhost:3001}
ADMIN_EMAIL=${ADMIN_EMAIL:-tim@apple.dev}
MEMBER_EMAIL=${MEMBER_EMAIL:-jony.ive@apple.dev}
PASSWORD=${PASSWORD:-tim@apple.dev}
OTHER_WORKSPACE_ADMIN=${OTHER_WORKSPACE_ADMIN:-}

failures=0

check() {
  local name=$1 condition=$2
  if eval "$condition"; then
    echo "PASS  $name"
  else
    echo "FAIL  $name"
    failures=$((failures + 1))
  fi
}

# gql <token> <json body>; prints the response body
gql() {
  curl -s "$SERVER_URL/metadata" -H 'content-type: application/json' -H "origin: $ORIGIN" \
    ${1:+-H "authorization: Bearer $1"} -d "$2"
}

# json <expression over d>; reads JSON from stdin, prints "" on any error
json() {
  python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print($1)
except Exception:
    print('')"
}

login() {
  local email=$1 login_token
  login_token=$(gql '' "{\"query\":\"mutation{getLoginTokenFromCredentials(email:\\\"$email\\\",password:\\\"$PASSWORD\\\",origin:\\\"$ORIGIN\\\"){loginToken{token}}}\"}" |
    json "d['data']['getLoginTokenFromCredentials']['loginToken']['token']")
  gql '' "{\"query\":\"mutation{getAuthTokensFromLoginToken(loginToken:\\\"$login_token\\\",origin:\\\"$ORIGIN\\\"){tokens{accessOrWorkspaceAgnosticToken{token}}}}\"}" |
    json "d['data']['getAuthTokensFromLoginToken']['tokens']['accessOrWorkspaceAgnosticToken']['token']"
}

create_provider() {
  gql "$1" "{\"query\":\"mutation{createOidcProvider(input:{name:\\\"$2\\\",issuer:\\\"$3\\\",clientId:\\\"$4\\\",clientSecret:\\\"smoke-secret\\\"}){id name issuer status}}\"}"
}

ADMIN=$(login "$ADMIN_EMAIL")
MEMBER=$(login "$MEMBER_EMAIL")
check "admin and member logged in" '[ -n "$ADMIN" ] && [ -n "$MEMBER" ]'

# Schema
schema=$(gql '' '{"query":"{ o: __type(name:\"OidcProvider\"){fields{name}} p: __type(name:\"PublicOidcProvider\"){fields{name}} m: __type(name:\"Mutation\"){fields{name}} }"}')
check "OidcProvider type has no secret field" \
  '[ "$(echo "$schema" | json "sorted(f[\"name\"] for f in d[\"data\"][\"o\"][\"fields\"]) == [\"clientId\", \"createdAt\", \"id\", \"issuer\", \"name\", \"status\", \"updatedAt\"]")" = True ]'
check "PublicOidcProvider exposes only id, name, loginUrl" \
  '[ "$(echo "$schema" | json "sorted(f[\"name\"] for f in d[\"data\"][\"p\"][\"fields\"]) == [\"id\", \"loginUrl\", \"name\"]")" = True ]'
check "legacy SSO mutation still in the schema" \
  'echo "$schema" | grep -q createOIDCIdentityProvider'

# Permissions: a member without SECURITY is refused on every admin operation
for operation in \
  'query{oidcProviders{id}}' \
  'mutation{createOidcProvider(input:{name:\"x\",issuer:\"http://localhost:8085/idp-a\",clientId:\"x\",clientSecret:\"x\"}){id}}' \
  'mutation{updateOidcProvider(input:{id:\"00000000-0000-4000-8000-000000000000\",name:\"x\"}){id}}' \
  'mutation{deleteOidcProvider(input:{id:\"00000000-0000-4000-8000-000000000000\"})}'; do
  response=$(gql "$MEMBER" "{\"query\":\"$operation\"}")
  check "member refused: $(echo "$operation" | cut -c1-40)" \
    'echo "$response" | grep -qi "permission\|forbidden"'
done
response=$(gql '' '{"query":"{oidcProviders{id}}"}')
check "anonymous refused" 'echo "$response" | grep -qi "unauthenticated\|forbidden\|authenticat"'

# CRUD
created=$(create_provider "$ADMIN" "Smoke A" "$IDP_URL/idp-a/" smoke-client)
provider_id=$(echo "$created" | json "d['data']['createOidcProvider']['id']")
check "create returns the provider with a normalized issuer" \
  '[ -n "$provider_id" ] && [ "$(echo "$created" | json "d[\"data\"][\"createOidcProvider\"][\"issuer\"]")" = "$IDP_URL/idp-a" ]'

check "create does not return the secret" '! echo "$created" | grep -qi "smoke-secret\|enc:v2"'

listed=$(gql "$ADMIN" '{"query":"{oidcProviders{id name status}}"}')
check "list contains the provider" 'echo "$listed" | grep -q "$provider_id"'

duplicate=$(create_provider "$ADMIN" "Smoke A" "$IDP_URL/idp-a" smoke-client)
check "duplicate issuer and client id is a conflict" 'echo "$duplicate" | grep -q CONFLICT'

check "invalid issuer is a user input error" \
  'create_provider "$ADMIN" "Bad" "not a url" c | grep -q BAD_USER_INPUT'
check "issuer without discovery is a user input error" \
  'create_provider "$ADMIN" "Bad" "http://localhost:9/nothing" c | grep -q BAD_USER_INPUT'

public=$(gql '' "{\"query\":\"{publicOidcProviders(origin:\\\"$ORIGIN\\\"){id name loginUrl}}\"}")
check "public list shows the active provider with a login url" \
  'echo "$public" | grep -q "$SERVER_URL/auth/oidc-sso/login/$provider_id"'

updated=$(gql "$ADMIN" "{\"query\":\"mutation{updateOidcProvider(input:{id:\\\"$provider_id\\\",name:\\\"Smoke B\\\",status:\\\"inactive\\\"}){name status}}\"}")
check "update changes name and status" \
  'echo "$updated" | grep -q "Smoke B" && echo "$updated" | grep -q inactive'

public=$(gql '' "{\"query\":\"{publicOidcProviders(origin:\\\"$ORIGIN\\\"){id}}\"}")
check "public list hides an inactive provider" '! echo "$public" | grep -q "$provider_id"'

bad_status=$(gql "$ADMIN" "{\"query\":\"mutation{updateOidcProvider(input:{id:\\\"$provider_id\\\",status:\\\"error\\\"}){id}}\"}")
check "unknown status is rejected" 'echo "$bad_status" | grep -q BAD_USER_INPUT'

# The provider row must hold the secret encrypted
stored=$(docker exec -i "${DB_CONTAINER:-twenty-dev-db-1}" psql -U postgres -d default -qAtc \
  "select \"clientSecret\" from core.\"workspaceOidcProvider\" where id='$provider_id'" 2>/dev/null)
check "secret is stored as enc:v2" 'case $stored in enc:v2:*) true ;; *) false ;; esac'

# A provider of another workspace is invisible: the id exists but not for this workspace
if [ -n "$OTHER_WORKSPACE_ADMIN" ]; then
  other=$(login "$OTHER_WORKSPACE_ADMIN")
  response=$(gql "$other" "{\"query\":\"mutation{deleteOidcProvider(input:{id:\\\"$provider_id\\\"})}\"}")
  check "other workspace cannot delete the provider" 'echo "$response" | grep -q NOT_FOUND'
fi

deleted=$(gql "$ADMIN" "{\"query\":\"mutation{deleteOidcProvider(input:{id:\\\"$provider_id\\\"})}\"}")
check "delete succeeds" 'echo "$deleted" | grep -q "\"deleteOidcProvider\":true"'
deleted_again=$(gql "$ADMIN" "{\"query\":\"mutation{deleteOidcProvider(input:{id:\\\"$provider_id\\\"})}\"}")
check "second delete is not found" 'echo "$deleted_again" | grep -q NOT_FOUND'

# Unknown origin gives an empty list, not an error
unknown=$(gql '' '{"query":"{publicOidcProviders(origin:\"http://unknown.example.com\"){id}}"}')
garbage=$(gql '' '{"query":"{publicOidcProviders(origin:\"not a url\"){id}}"}')
check "public query returns an empty list for an unparsable origin" 'echo "$garbage" | grep -q "\"publicOidcProviders\":\[\]"'
check "public query never errors on an unknown origin" 'echo "$unknown" | grep -q "\"publicOidcProviders\":\["'

echo
[ "$failures" -eq 0 ] && echo "ALL PASS" || echo "$failures FAILED"
exit "$failures"
