# OIDC SSO: administrator guide

Sign in to a Twenty workspace through a corporate OpenID Connect provider (Keycloak, Okta, Auth0, Google and others). Only the Authorization Code flow with PKCE S256 is supported. Providers are configured per workspace and a workspace can have several. Alternatively one provider can be set for the whole platform through environment variables ([below](#one-provider-for-the-whole-platform)).

This is the fork's own implementation. The old Enterprise "SSO" block on the security page is hidden unless the instance has a valid Enterprise plan, and has nothing to do with OIDC providers.

Next: [identity provider recipes](providers.md), [reference and troubleshooting](reference.md).

## Prerequisites

- Twenty is reachable at a stable address and `SERVER_URL` in the server environment matches it.
- In production the IdP uses `https`. An `http` issuer is accepted only with `NODE_ENV=development`.
- The IdP supports PKCE S256 and returns `email` with `email_verified=true` in the id_token. Sign-in is impossible without it, check the [compatibility checklist](providers.md#compatibility-checklist).
- You have the Security permission in the workspace (an administrator).
- The workspace is activated (onboarding finished).

## Quick start

1. In the IdP create an application of type Web / Confidential with the Authorization Code flow. You can enter any redirect URI for now, the real one comes in step 3.
2. Note the Issuer, Client ID and Client secret.
3. In Twenty open Settings, Security. In the "OIDC" card click "Add OIDC provider". The dialog shows the redirect URI at the top, like `https://<your-address>/auth/oidc-sso/callback`. Copy it into the list of allowed redirect URIs in the IdP.
4. Fill in Name (this is the sign-in button text), Issuer URL, Client ID, Client secret and click "Add". On save Twenty downloads the IdP configuration and validates it. If the IdP is unreachable or the configuration does not fit, the provider is not created and an error is shown.
5. Sign out and open the workspace sign-in page. A "Sign in with <Name>" button should appear. Click it and sign in.

The client secret is encrypted and is never returned to the UI or the API.

## How sign-in works

1. The user opens the workspace address and clicks "Sign in with <Name>".
2. The browser goes to `/auth/oidc-sso/login/<provider id>`. The server creates a one-time `state`, `nonce` and PKCE verifier and sends the browser to the IdP.
3. The user signs in at the IdP.
4. The IdP returns the browser to `/auth/oidc-sso/callback`. The server exchanges the code for tokens and verifies the id_token signature and `nonce`.
5. The email (required, only with `email_verified=true`) and the name from `given_name` and `family_name` are taken from the id_token.
6. The user is signed in to the workspace. Any failure ends the flow with a redirect to the `/verify` page with a message.

An unfinished sign-in lives for 10 minutes and can be used once. A replayed callback or a foreign or expired `state` is rejected.

## Who can sign in

- An existing workspace member with the same email: signs in.
- A new user: only by invitation. Open the workspace invite link, then click the sign-in button: the invite identifier (`workspaceInviteHash`) is passed along automatically. If the public invite link is enabled, it works too.
- A new user without an invitation gets "User does not have access to this workspace".
- Until the workspace is activated, new users get "Workspace is not ready to welcome new members".

The workspace administrator sets the trust in the IdP: there is no per-provider email domain restriction. To limit who can sign in, do it at the IdP.

## Managing providers

Each row in the OIDC card has a menu:

- Deactivate / Activate: an inactive provider disappears from the sign-in screen and sign-in through it is rejected. The data stays.
- Delete: after confirmation removes the provider, users can no longer sign in through it.

You can add several providers, the sign-in screen shows a button for each. The same Issuer with the same Client ID cannot be added twice.

## One provider for the whole platform

If the instance has one corporate IdP for every workspace, set it in the server environment:

```
OIDC_ISSUER=https://idp.example.com/auth/v1
OIDC_CLIENT_ID=twenty
OIDC_CLIENT_SECRET=...
OIDC_NAME=Company sign-in   # optional, "OIDC" by default
```

- One client and one redirect URI in the IdP are enough: `https://<your-address>/auth/oidc-sso/callback`.
- The provider works only when the issuer, client id and client secret are all set and the issuer is valid (`https` in production). If at least one of the three is set but the setup is incomplete or the issuer is invalid, OIDC sign-in is disabled everywhere: no button, per-workspace setup stays off too, and the log gets a warning. Stored workspace providers do not come back to life. To return to per-workspace setup, remove all three variables.
- While it is on, the sign-in page of every workspace shows one button named `OIDC_NAME`, and per-workspace setup is switched off: Settings, Security shows it read-only, and create, update and delete are rejected.
- Providers created earlier in workspaces are not deleted but are not used. Remove the variables and they work again.
- The provider is available in every workspace of the instance: there is no per-workspace switch (workspaces have no SSO flag). The only check on a workspace is membership, an invitation or an approved email domain. Access rules are the same as before: a new user signs in by invitation only, `email_verified` is required. The secret comes from the environment and never reaches the interface.
- Changing the environment of the server usually means restarting the container.

## What is not there yet

- Editing Issuer, Client ID and secret. To change them, delete the provider and create it again. Renaming and switching on or off is possible through the API ([reference](reference.md#graphql-api)).
- A workspace picker on the shared sign-in screen and SSO routing by email domain. Users must sign in from the workspace address: this way an outsider cannot learn which workspaces exist.
- An "SSO only" mode or disabling password sign-in for a workspace.
- An "Error" provider status, only Active and Inactive exist.
- Providers that do not return `email_verified` (for example Microsoft Entra ID).
- SAML, SCIM, group and role mapping.

## FAQ

**The sign-in button does not appear.** The provider must be Active and the page must be opened from the address of that workspace.

**Sign-in ends with "Single sign-on authentication failed".** This is a generic text, the reason is in the server log. See [troubleshooting](reference.md#troubleshooting).

**Can password sign-in and SSO be used together?** Yes, password sign-in stays as it was.
