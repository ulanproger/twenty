# OIDC SSO: reference and troubleshooting

## Endpoints

| Purpose | Address |
|---|---|
| Start sign-in | `GET <SERVER_URL>/auth/oidc-sso/login/<providerId>[?workspaceInviteHash=<hash>]` |
| Return from the IdP (redirect URI) | `GET <SERVER_URL>/auth/oidc-sso/callback` |
| Admin and public API | `POST <SERVER_URL>/metadata` (GraphQL) |

`SERVER_URL` is the public address of the Twenty server. The address in the "Add OIDC provider" dialog is built from it.

## Protocol details

- Flow: Authorization Code, PKCE S256, scope `openid email profile`.
- `state`, `nonce` and the PKCE verifier are single-use. An unfinished sign-in lives for 10 minutes, one browser session keeps at most 5 unfinished sign-ins (older ones are evicted).
- The IdP configuration (discovery) is cached for 10 minutes, requests to the IdP time out after 10 seconds. After changing IdP settings the new configuration is picked up within 10 minutes.
- The id_token is verified by signature (keys from `jwks_uri`), `nonce`, issuer and audience. The `none` and `HS*` algorithms are not accepted.
- The email is taken only from `email` and only when `email_verified` is `true` (a boolean or the string `true`, any case). The `upn` and `preferred_username` fields are not read. The name comes from `given_name` and `family_name`.
- Client authentication at the token endpoint: `client_secret_basic` or `client_secret_post`, chosen by the `openid-client` library from the IdP data.

## Environment variables

| Variable | Purpose |
|---|---|
| `SERVER_URL` | Public server address, the redirect URI is built from it. |
| `ENCRYPTION_KEY` | Key that encrypts IdP client secrets in the database. |
| `FALLBACK_ENCRYPTION_KEY` | Previous key during rotation (see below). |
| `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS` | Comma-separated hosts in internal networks that Twenty may call. Needed if the IdP sits in your private network. Such addresses are blocked by default. |
| `NODE_ENV` | Local development only: `development` allows an `http` Issuer. Do not enable it in production, the Issuer must be `https`. |

The module introduces no new variables.

Key rotation: set the new `ENCRYPTION_KEY`, put the previous one into `FALLBACK_ENCRYPTION_KEY`, then run the `secret-encryption:rotate` command. OIDC provider secrets are part of the re-encrypted set. The command is idempotent.

## GraphQL API

You need a user token with the Security permission in the workspace. Requests go to `/metadata` with an `Origin` header set to the workspace address. Errors come back with HTTP 200 and an `errors` field.

Getting a token with a password (for users that have one):

```bash
BASE=https://crm.example.com
LOGIN_TOKEN=$(curl -s $BASE/metadata -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"query":"mutation{getLoginTokenFromCredentials(email:\"admin@example.com\",password:\"...\",origin:\"'$BASE'\"){loginToken{token}}}"}' \
  | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
TOKEN=$(curl -s $BASE/metadata -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"query":"mutation{getAuthTokensFromLoginToken(loginToken:\"'$LOGIN_TOKEN'\",origin:\"'$BASE'\"){tokens{accessOrWorkspaceAgnosticToken{token}}}}"}' \
  | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
```

The snippet breaks on a password containing `"` or `\`: build the JSON with `jq -n` in that case. For users without a password take the token from the web UI session (not tested). Then send `Authorization: Bearer $TOKEN`.

List providers (the secret is not returned):

```graphql
query { oidcProviders { id name issuer clientId status } }
```

Create. Fields: `name` up to 255 characters, `issuer` up to 2048, `clientId` up to 255, `clientSecret` up to 2048. Values must not be empty.

```graphql
mutation {
  createOidcProvider(input: {
    name: "Corporate SSO"
    issuer: "https://idp.example.com/realms/main"
    clientId: "twenty"
    clientSecret: "..."
  }) { id name status }
}
```

Update. Only `name` and `status` (`active` or `inactive`) can change:

```graphql
mutation { updateOidcProvider(input: { id: "<uuid>", name: "New name", status: "inactive" }) { id name status } }
```

Delete (returns `true`):

```graphql
mutation { deleteOidcProvider(input: { id: "<uuid>" }) }
```

Public list for the sign-in screen (no token, active providers of the workspace found by `origin` only):

```graphql
query { publicOidcProviders(origin: "https://crm.example.com") { name loginUrl } }
```

## Creation constraints

- Issuer: `http` or `https` only (`https` is required outside development), no `?`, `#`, login or password. Trailing `/` are stripped: `https://idp/a/` and `https://idp/a` are the same Issuer.
- On creation Twenty downloads discovery and checks that `issuer` matches, that `authorization_endpoint`, `token_endpoint` and `jwks_uri` exist and (if declared) that S256 is supported.
- The Issuer and Client ID pair is unique in a workspace. There is no limit on the number of providers.

## Security model

- The client secret is encrypted in the database with a versioned key and is never returned by the API or UI.
- `state` and `nonce` are single-use, bound to the browser session, valid for 10 minutes.
- Signing in through a provider of another workspace is rejected (the provider must belong to the workspace whose address the user came to). Substituting a foreign `workspaceInviteHash` is rejected.
- Requests to the IdP go through SSRF protection: addresses in internal networks are blocked until the host is explicitly allowed.
- The email is accepted only when the IdP marks it verified.
- Trust in the IdP is set by the workspace administrator. They can choose any IdP, and it decides who a "verified user" with a given email is.

## Error messages

A user sees either a text from the Twenty core or a generic text. The detailed reason goes only to the server log as `OIDC sign-in failed: ...`.

| What the user sees on `/verify` | Reason | What to do |
|---|---|---|
| Single sign-on authentication failed | Any IdP or validation error, details in the log | Check the log (table below) |
| User does not have access to this workspace | New user without an invitation | Send an invitation, sign in from a link with `workspaceInviteHash` |
| Workspace is not ready to welcome new members | The workspace is not activated | Finish workspace onboarding |

Reasons in the log (after `OIDC sign-in failed:`):

| In the log | Meaning | Action |
|---|---|---|
| `OIDC identity rejected: email-missing` | No `email` in the id_token | Enable the `email` scope, check mapping in the IdP |
| `OIDC identity rejected: email-not-verified` | No `email_verified=true` | Verify the user's email in the IdP or configure the claim |
| `OIDC identity rejected: email-invalid` | Malformed email | Fix the address in the IdP |
| `OIDC provider access denied: provider-inactive` | The provider is switched off | Activate the provider |
| `OIDC provider access denied: workspace-mismatch` | Provider from another workspace | Sign in from the right workspace address |
| `OIDC login missing` / `OIDC login expired` | No sign-in data or more than 10 minutes passed, replayed callback, different browser | Start again from the button |
| `OIDC provider not found` | The provider was deleted | Check the link, reload the sign-in page |
| `OIDC discovery rejected: ...` | `issuer-mismatch`, `endpoint-missing` or `pkce-s256-unsupported` | Fix the Issuer or IdP settings |
| `Workspace invite hash is too long` | `workspaceInviteHash` longer than 255 characters | Use a valid link |

Errors when creating a provider in the UI and API:

| Code | User text | Reason |
|---|---|---|
| `INVALID_ISSUER` | Invalid issuer URL. | Not `http(s)`, `http` outside development, has `?`, `#` or login and password |
| `ISSUER_DISCOVERY_FAILED` | Could not load the OpenID configuration from the issuer. | IdP unreachable, address blocked by SSRF protection, no discovery, configuration validation failed |
| `PROVIDER_ALREADY_EXISTS` | This identity provider is already configured. | This Issuer and Client ID pair already exists |
| `PROVIDER_NOT_FOUND` | Identity provider not found. | Wrong `id` on update or delete |

## Troubleshooting

1. Check discovery from the machine where the server runs: `curl -s <issuer>/.well-known/openid-configuration`. The `issuer` field must match what you entered.
2. Server logs: look for `OIDC sign-in failed`. With Docker Compose: `docker compose logs server | grep "OIDC sign-in failed"`.
3. If the IdP is in an internal network and creation fails with `ISSUER_DISCOVERY_FAILED`, add its host to `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS` and restart the server.
4. The redirect URI in the IdP must match the one shown in the dialog character for character (scheme, host, port, path).
5. If the IdP does not return `email_verified`, sign-in will not work: configure the claim in the IdP or change the IdP.

## Limitations

See the [guide](guide.md#what-is-not-there-yet). Also: live testing was done only against a test IdP; a second workspace on one instance, regression of Google and Microsoft sign-in and the real IdPs from the [recipes](providers.md) were not tested.
