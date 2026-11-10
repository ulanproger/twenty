import { OIDC_GLOBAL_PROVIDER_ID } from 'src/engine/core-modules/oidc-sso/constants/oidc-global-provider-id.constant';
import { type WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import {
  toOidcGlobalProviderDTO,
  toOidcProviderDTO,
} from 'src/engine/core-modules/oidc-sso/utils/to-oidc-provider-dto.util';

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

describe('toOidcGlobalProviderDTO', () => {
  const globalProvider = {
    id: OIDC_GLOBAL_PROVIDER_ID,
    name: 'Rauthy',
    issuer: 'https://idp.example.com',
    clientId: 'client-1',
    clientSecret: 'secret-1',
  } as const;

  it('is marked global and never carries the secret', () => {
    const dto = toOidcGlobalProviderDTO(globalProvider);

    expect(dto).toMatchObject({ isGlobal: true, status: 'active' });
    expect(JSON.stringify(dto)).not.toContain('secret-1');
  });

  it('reports the same timestamps on every call', () => {
    expect(toOidcGlobalProviderDTO(globalProvider).createdAt).toBe(
      toOidcGlobalProviderDTO(globalProvider).createdAt,
    );
  });
});
