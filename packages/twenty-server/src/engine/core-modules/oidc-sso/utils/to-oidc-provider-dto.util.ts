import { type OidcProviderDTO } from 'src/engine/core-modules/oidc-sso/dtos/oidc-provider.dto';
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
  createdAt,
  updatedAt,
});
