import { type WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import { toOidcProviderDTO } from 'src/engine/core-modules/oidc-sso/utils/to-oidc-provider-dto.util';

describe('toOidcProviderDTO', () => {
  it('drops the client secret and the workspace binding', () => {
    const createdAt = new Date('2026-01-01');
    const entity = {
      id: 'provider-1',
      workspaceId: 'workspace-a',
      name: 'Okta',
      issuer: 'https://idp.example.com',
      clientId: 'client-1',
      clientSecret: 'enc:v2:secret',
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    } as WorkspaceOidcProviderEntity;

    expect(toOidcProviderDTO(entity)).toEqual({
      id: 'provider-1',
      name: 'Okta',
      issuer: 'https://idp.example.com',
      clientId: 'client-1',
      status: 'active',
      isGlobal: false,
      createdAt,
      updatedAt: createdAt,
    });
  });
});
