# OIDC SSO module (fork)

Clean-room OpenID Connect sign-in (Authorization Code + PKCE S256), providers per workspace. Independent of the Enterprise `@license Enterprise` SSO module, which stays registered but unused.

User docs: `docs/oidc-sso/`. Design, decisions and history: `docs/oidc-sso-roadmap.md`. Local stand and smoke scripts: `scripts/fork/oidc-dev/README.md`.

## Code map

Server (this directory):

| Path | Role |
|---|---|
| `controllers/oidc-sso-auth.controller.ts` | `GET /auth/oidc-sso/login/:id` and `/callback`, errors redirect to `/verify` |
| `services/oidc-protocol.service.ts` | discovery (cached), authorization URL, code exchange, id_token checks |
| `services/oidc-provider.service.ts` | provider CRUD, issuer validation, secret encryption |
| `services/oidc-account.service.ts` | sign-in or sign-up through `AuthService`, connected account |
| `resolvers/` | admin API (`oidcProviders` and mutations) and public `publicOidcProviders` |
| `utils/` | pure functions: issuer normalization, discovery validation, identity extraction, login session, access check |
| `entities/`, `migrations/` | `workspaceOidcProvider` table, hand-written instance command |
| `dtos/`, `filters/`, `constants/`, `oidc-sso.exception.ts` | API shapes, error mapping, paths |

Frontend: `packages/twenty-front/src/modules/oidc-sso/` (sign-in button, settings section, create dialog, hand-written gql, tests).

## Seams (the only edits in upstream files)

All are additive (0 deleted lines) except S4, which rewrites the legacy SSO section and is listed in `MODIFYING_SEAMS` with a ceiling on deleted lines. `bash scripts/fork/check-oidc-seams.sh` enforces it, the allowed paths are in `scripts/fork/oidc-seams.txt`.

| Seam | File | Change | On conflict |
|---|---|---|---|
| S1 | `engine/core-modules/core-engine.module.ts` | +1 import, +1 entry in `imports` next to `WorkspaceSsoModule` | keep upstream, re-add both lines |
| S2 | `engine/core-modules/auth/auth.module.ts` | `AuthService` added to `exports` | keep upstream, re-add the export |
| S3 | `database/commands/secret-encryption-rotation/constants/secret-encryption-rotation-site-entries.constant.ts` | +1 entry for the provider secret column | keep upstream, re-add the entry |
| S4 | `twenty-front/.../SettingsSecuritySettings.tsx` | +1 import, `<SettingsOidcProvidersSection />` outside the SSO entitlement check; the legacy SSO section is wrapped in `{hasSsoEntitlement && (...)}` and its upgrade card is removed | keep upstream, re-wrap the legacy section in `{hasSsoEntitlement && (...)}` without the upgrade card, re-add the import and the section after it |
| S5 | `twenty-front/.../SignInUpWorkspaceScopeForm.tsx` | +1 import, `{!shouldUseBypass && <SignInUpWithOidc />}` | keep upstream, re-add both |
| S7 | `test/integration/endpoint-permissions/__snapshots__/endpoint-permission-declarations.integration-spec.ts.snap` | entries for our controller and resolvers | regenerate, do not hand-edit (see below) |

S6 (`SignInUpWorkspaceScopeFormEffect.tsx`, `useHasMultipleAuthMethods.ts`) is not needed: the effect has fixed dependencies and would run before our query loads. The two paths stay in `oidc-seams.txt`, so the six seams above are the active ones.

## Syncing with upstream

1. `git fetch upstream && git merge upstream/main` (merge, not rebase). `git config rerere.enabled true`.
2. Resolve seam conflicts with the table above.
3. `bash scripts/fork/check-oidc-seams.sh` must print `OK: 6 seam file(s)`. Run it after the merge commit exists, it compares with the merge base.
4. `yarn install`, then `npx tsgo -p tsconfig.json --noEmit` in `twenty-server` and `twenty-front`, unit tests of this module, the smoke scripts.
5. Regenerate the S7 snapshot with the integration test: from `packages/twenty-server`, `NODE_ENV=test npx jest --config ./jest-integration.config.ts test/integration/endpoint-permissions`.

Known blocker for the next sync: upstream #29661 removed `AuthPrincipalGuard` and `SettingsPermissionGuard` and changed the snapshot format, so `oidc-provider.resolver.ts` needs a port to `AccessPolicyGuard`. Details and steps: section 9 of `docs/oidc-sso-roadmap.md`.

## Database

One table, created by a hand-written instance command in `migrations/` with a fixed version `'2.51.0'` (do not import `TWENTY_CURRENT_VERSION`). SQL is idempotent. See section 3.5 of the roadmap.
