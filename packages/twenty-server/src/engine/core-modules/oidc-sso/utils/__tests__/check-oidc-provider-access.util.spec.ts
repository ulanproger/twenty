import { checkOidcProviderAccess } from 'src/engine/core-modules/oidc-sso/utils/check-oidc-provider-access.util';

describe('checkOidcProviderAccess', () => {
  it.each([
    ['own active provider', 'workspace-1', 'active', { status: 'granted' }],
    [
      'own inactive provider',
      'workspace-1',
      'inactive',
      { status: 'denied', reason: 'provider-inactive' },
    ],
    [
      'foreign active provider',
      'workspace-2',
      'active',
      { status: 'denied', reason: 'workspace-mismatch' },
    ],
    [
      'foreign inactive provider',
      'workspace-2',
      'inactive',
      { status: 'denied', reason: 'workspace-mismatch' },
    ],
  ] as const)('%s', (_label, providerWorkspaceId, status, expected) => {
    expect(
      checkOidcProviderAccess({
        provider: { workspaceId: providerWorkspaceId, status },
        workspaceId: 'workspace-1',
      }),
    ).toEqual(expected);
  });
});
