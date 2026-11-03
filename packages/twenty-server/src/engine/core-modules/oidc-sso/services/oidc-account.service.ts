import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { ConnectedAccountProvider } from 'twenty-shared/types';
import { assertIsDefinedOrThrow } from 'twenty-shared/utils';

import { AuthService } from 'src/engine/core-modules/auth/services/auth.service';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { type WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import { checkOidcProviderAccess } from 'src/engine/core-modules/oidc-sso/utils/check-oidc-provider-access.util';
import { type OidcIdentity } from 'src/engine/core-modules/oidc-sso/utils/extract-oidc-identity.util';
import { UserService } from 'src/engine/core-modules/user/services/user.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';

@Injectable()
export class OidcAccountService {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly loginTokenService: LoginTokenService,
  ) {}

  // Returns the URL of the workspace /verify page carrying a login token.
  async signIn({
    provider,
    identity,
    claims,
    workspaceInviteHash,
  }: {
    provider: Pick<WorkspaceOidcProviderEntity, 'workspaceId' | 'status'>;
    identity: OidcIdentity;
    claims: Record<string, unknown>;
    workspaceInviteHash: string | undefined;
  }): Promise<string> {
    const currentWorkspace = await this.authService.findWorkspaceForSignInUp({
      workspaceId: provider.workspaceId,
      workspaceInviteHash,
      email: identity.email,
      authProvider: AuthProviderEnum.SSO,
    });

    assertIsDefinedOrThrow(currentWorkspace, new Error('Workspace not found'));

    // An invite hash resolves to the invited workspace whatever the provider
    // belongs to, so the provider must be checked against the resolved one.
    const access = checkOidcProviderAccess({
      provider,
      workspaceId: currentWorkspace.id,
    });

    if (access.status === 'denied') {
      throw new Error(`OIDC provider access denied: ${access.reason}`);
    }

    const invitation = await this.authService.findInvitationForSignInUp({
      currentWorkspace,
      email: identity.email,
    });

    const existingUser = await this.userService.findUserByEmail(identity.email);

    const { userData } = this.authService.formatUserDataPayload(
      { ...identity, isEmailAlreadyVerified: true },
      existingUser,
    );

    await this.authService.checkAccessForSignIn({
      userData,
      invitation,
      workspaceInviteHash,
      workspace: currentWorkspace,
    });

    const { workspace, user } = await this.authService.signInUp({
      userData,
      workspace: currentWorkspace,
      invitation,
      authParams: { provider: AuthProviderEnum.SSO },
    });

    if (!user.isEmailVerified && !isNonEmptyString(user.passwordHash)) {
      await this.userService.markEmailAsVerified(user.id);
    }

    await this.authService.createSsoConnectedAccountIfFeatureFlagIsOn({
      workspaceId: workspace.id,
      userId: user.id,
      handle: identity.email.toLowerCase(),
      authProvider: AuthProviderEnum.SSO,
      oidcTokenClaims: claims,
      connectedAccountProvider: ConnectedAccountProvider.OIDC,
    });

    const loginToken = await this.loginTokenService.generateLoginToken(
      user.email,
      workspace.id,
      AuthProviderEnum.SSO,
    );

    return this.authService.computeRedirectURI({
      loginToken: loginToken.token,
      workspace,
    });
  }
}
