# Dev stand for the fork's OIDC SSO

Local OIDC provider (`mock-oauth2-server`). Any path is its own issuer, so one container gives two IdPs.

```bash
docker compose -f scripts/fork/oidc-dev/docker-compose.yml up -d     # start
docker compose -f scripts/fork/oidc-dev/docker-compose.yml down      # stop
curl -s http://localhost:8085/idp-a/.well-known/openid-configuration  # discovery
```

## Provider form values in Twenty

| Field | Value |
|---|---|
| Issuer | `http://localhost:8085/idp-a` (second provider: `/idp-b`) |
| Client ID / secret | any string, the mock accepts everything |
| Callback (redirect URI) | `http://localhost:3000/auth/oidc-sso/callback` |

Sign-in page of the mock: `username` (becomes `sub`) plus a "claims" JSON textarea merged into the id_token.

Twenty blocks private addresses for outbound calls. For `localhost` set in `packages/twenty-server/.env`:

```
OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS=localhost
```

Leave it unset to test the "internal host is blocked" scenario.

## Scenarios and claims to paste

| Scenario | Claims JSON | Expected |
|---|---|---|
| New user | `{"email":"new@example.com","given_name":"New","family_name":"User"}` | account created, signed in |
| Existing user | `{"email":"<existing email>"}` | signed in as that user |
| Azure-style `upn` | `{"upn":"alice@corp.example"}` | email taken from `upn` |
| Unverified email | `{"email":"a@example.com","email_verified":false}` | rejected |
| No email | `{}` | rejected |
| Invite | open the invite link, then sign in via SSO | joins the invited workspace |
| Inactive provider | set the provider to Inactive | rejected / not offered |
| Bad or reused `state` | replay a callback URL, or change `state` | rejected |
| Foreign workspace | provider of workspace A with `workspaceInviteHash` of B | rejected |
| Internal host blocked | unset `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS` | provider creation fails with an issuer error |
| Two providers | add `/idp-a` and `/idp-b` to one workspace | both selectable |

## Fork sync setup (once per clone)

```bash
git remote add upstream https://github.com/twentyhq/twenty.git
git fetch upstream main
git config rerere.enabled true
bash scripts/fork/check-oidc-seams.sh    # run before every commit and after every sync
```
