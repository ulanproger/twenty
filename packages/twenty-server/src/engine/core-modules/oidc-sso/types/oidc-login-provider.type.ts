import { type WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

// What the login flow needs from a provider. A stored provider satisfies it as is;
// the global provider has no row and no encrypted secret.
export type OidcLoginProvider = Pick<
  WorkspaceOidcProviderEntity,
  'id' | 'workspaceId' | 'status' | 'issuer' | 'clientId'
> &
  Partial<Pick<WorkspaceOidcProviderEntity, 'clientSecret'>> & {
    workspace: WorkspaceEntity;
  };
