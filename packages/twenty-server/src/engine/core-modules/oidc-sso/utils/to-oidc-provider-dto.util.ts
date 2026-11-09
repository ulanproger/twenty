import { type OidcProviderDTO } from 'src/engine/core-modules/oidc-sso/dtos/oidc-provider.dto';
import { type OidcGlobalProvider } from 'src/engine/core-modules/oidc-sso/utils/read-oidc-global-provider.util';
import { type WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';

// Picks fields explicitly so the encrypted client secret can never leak by spread.
export const toOidcProviderDTO = ({
  id,
  name,
  issuer,
  clientId,
  status,
  createdAt,
  updatedAt,
}: WorkspaceOidcProviderEntity): OidcProviderDTO => ({
  id,
  name,
  issuer,
  clientId,
  status,
  isGlobal: false,
  createdAt,
  updatedAt,
});

export const toGlobalOidcProviderDTO = ({
  id,
  name,
  issuer,
  clientId,
}: OidcGlobalProvider): OidcProviderDTO => {
  const now = new Date();

  return {
    id,
    name,
    issuer,
    clientId,
    status: 'active',
    isGlobal: true,
    createdAt: now,
    updatedAt: now,
  };
};
