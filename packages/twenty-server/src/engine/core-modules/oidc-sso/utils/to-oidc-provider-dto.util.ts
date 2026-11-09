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

// The global provider has no row, so it reports the process start instead of a new time on every query.
const OIDC_GLOBAL_PROVIDER_TIMESTAMP = new Date();

export const toGlobalOidcProviderDTO = ({
  id,
  name,
  issuer,
  clientId,
}: OidcGlobalProvider): OidcProviderDTO => ({
  id,
  name,
  issuer,
  clientId,
  status: 'active',
  isGlobal: true,
  createdAt: OIDC_GLOBAL_PROVIDER_TIMESTAMP,
  updatedAt: OIDC_GLOBAL_PROVIDER_TIMESTAMP,
});
