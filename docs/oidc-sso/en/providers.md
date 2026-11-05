# OIDC SSO: identity provider recipes

Important: the module was tested only against a test IdP (`mock-oauth2-server`). None of the providers below was tested live. Items marked "checked against the vendor docs" were compared with the official pages, verify everything else in your IdP documentation.

## Compatibility checklist

Any IdP must meet all points, otherwise the provider is not created or sign-in is rejected:

1. Publishes `<issuer>/.well-known/openid-configuration` and the `issuer` field in it matches the Issuer you entered. A trailing `/` does not matter, it is stripped on both sides.
2. Discovery has `authorization_endpoint`, `token_endpoint` and `jwks_uri`. If the IdP declares `code_challenge_methods_supported`, it must include `S256`; if the field is absent the check is skipped, but the IdP must still accept PKCE S256.
3. Signs the id_token asymmetrically (RS256 by default, otherwise the first of `RS*`, `PS*`, `ES*`, `EdDSA` that the IdP declares).
4. Returns `email` and `email_verified=true` (a boolean or the string `true`) in the id_token for the requested scopes `openid email profile`.
5. Accepts client authentication via `client_secret_basic` or `client_secret_post`.
6. Is reachable from the Twenty server over the network. Addresses in internal networks are blocked by default, see the [reference](reference.md#environment-variables).

The Issuer must not contain `?`, `#`, a login or a password.

## Google

Checked against the vendor docs.

- Issuer: `https://accounts.google.com`.
- `email_verified` is returned with the `email` scope. PKCE S256 is declared in discovery.
- In Google Cloud Console create an OAuth client of type Web application. Add the redirect URI from the Twenty dialog to the client's Authorized redirect URIs (Clients, your client).
- Restricting sign-in to your organization is done only by Google settings (the app's user type), the Twenty module does not filter domains.

## Okta

Partly checked against the vendor docs.

- Issuer: the Org server address `https://<your-domain>.okta.com` or a Custom Authorization Server address `https://<your-domain>.okta.com/oauth2/<id>` (often `default`). Pick the one whose discovery works for you.
- `email_verified` is returned with the `email` scope and is `true` when the primary email is verified.
- Application: OIDC, Web Application, Authorization Code grant. Add the redirect URI from the Twenty dialog to Sign-in redirect URIs.

## Keycloak

Not checked against the vendor docs, verify.

- Issuer: `https://<host>/realms/<realm>`. Older versions have `/auth` before `realms`.
- Client: Client authentication on (confidential), Standard flow on. Add the redirect URI from the Twenty dialog to Valid redirect URIs.
- PKCE: make sure the S256 method is allowed for the client.
- Make sure the user's email is verified: Keycloak sets `email_verified` from that field.

## Auth0

Not checked against the vendor docs, verify.

- Issuer: `https://<tenant>.auth0.com` (discovery usually has a trailing `/`, which is fine).
- Application: Regular Web Application. Add the redirect URI from the Twenty dialog to Allowed Callback URLs.
- The user's email must be verified, otherwise `email_verified` is `false`.

## Authentik

Not checked against the vendor docs, verify.

- Create an OAuth2/OpenID provider with Client type Confidential and bind it to an application. The Issuer and discovery come from the application page (an address like `https://<host>/application/o/<slug>/`).
- Add the redirect URI from the Twenty dialog to the provider's Redirect URIs.
- Make sure the `email` scope is enabled and returns `email_verified`.

## Microsoft Entra ID

Not supported. Entra's id_token has no standard `email_verified` (the docs only list an optional `xms_edov` claim about the email domain owner), while Twenty requires `email_verified=true`. The `upn` field is intentionally not read. Options: put an intermediary IdP between Twenty and Entra (for example Keycloak or Authentik with Entra as an external login source) that issues `email_verified` itself, or use another IdP for the workspace. Such a chain was not tested.
