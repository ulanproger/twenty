import { type WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';

export type OidcProviderAccessResult =
  | { status: 'granted' }
  | { status: 'denied'; reason: 'workspace-mismatch' | 'provider-inactive' };

// Callers must log the reason but show the user one generic error.
export const checkOidcProviderAccess = ({
  provider,
  workspaceId,
}: {
  provider: Pick<WorkspaceOidcProviderEntity, 'workspaceId' | 'status'>;
  workspaceId: string;
}): OidcProviderAccessResult => {
  if (provider.workspaceId !== workspaceId) {
    return { status: 'denied', reason: 'workspace-mismatch' };
  }

  if (provider.status !== 'active') {
    return { status: 'denied', reason: 'provider-inactive' };
  }

  return { status: 'granted' };
};
