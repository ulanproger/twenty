import { type WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

type OidcLoginProviderBase = Pick<
  WorkspaceOidcProviderEntity,
  'id' | 'workspaceId' | 'status' | 'issuer' | 'clientId'
> & { workspace: WorkspaceEntity };

// What the login flow needs from a provider. The global provider has no row and no
// encrypted secret, its secret is read from the environment.
export type OidcLoginProvider =
  | (OidcLoginProviderBase & { isGlobal: true })
  | (OidcLoginProviderBase &
      Pick<WorkspaceOidcProviderEntity, 'clientSecret'> & {
        isGlobal: false;
      });

export type GlobalOidcLoginProvider = Extract<
  OidcLoginProvider,
  { isGlobal: true }
>;
