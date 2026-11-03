import {
  Controller,
  Get,
  Logger,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';

import { isNonEmptyString, isString } from '@sniptt/guards';
import { type Request, type Response } from 'express';
import { type Session } from 'express-session';
import { AppPath } from 'twenty-shared/types';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { GuardRedirectService } from 'src/engine/core-modules/guard-redirect/services/guard-redirect.service';
import {
  OIDC_SSO_CALLBACK_PATH,
  OIDC_SSO_LOGIN_PATH,
} from 'src/engine/core-modules/oidc-sso/constants/oidc-sso-paths.constant';
import { type WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import { OidcAccountService } from 'src/engine/core-modules/oidc-sso/services/oidc-account.service';
import { OidcProtocolService } from 'src/engine/core-modules/oidc-sso/services/oidc-protocol.service';
import { OidcProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-provider.service';
import { checkOidcProviderAccess } from 'src/engine/core-modules/oidc-sso/utils/check-oidc-provider-access.util';
import { extractOidcIdentity } from 'src/engine/core-modules/oidc-sso/utils/extract-oidc-identity.util';
import {
  addOidcLogin,
  takeOidcLogin,
} from 'src/engine/core-modules/oidc-sso/utils/oidc-login-session.util';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

const OIDC_LOGIN_MAX_AGE_MS = 10 * 60 * 1000;
const OIDC_LOGINS_MAX_PER_SESSION = 5;
// The hash goes into the session, so its size is capped.
const WORKSPACE_INVITE_HASH_MAX_LENGTH = 255;

type OidcSessionRequest = Request & {
  session: Session & { oidcLogins?: unknown };
};

@Controller()
export class OidcSsoAuthController {
  private readonly logger = new Logger(OidcSsoAuthController.name);

  constructor(
    private readonly oidcProviderService: OidcProviderService,
    private readonly oidcProtocolService: OidcProtocolService,
    private readonly oidcAccountService: OidcAccountService,
    private readonly guardRedirectService: GuardRedirectService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
  ) {}

  @Get(`${OIDC_SSO_LOGIN_PATH}/:providerId`)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async login(
    @Param('providerId') providerId: string,
    @Query('workspaceInviteHash') workspaceInviteHash: unknown,
    @Req() request: OidcSessionRequest,
    @Res() response: Response,
  ) {
    let workspace: WorkspaceEntity | undefined;

    try {
      const provider =
        await this.oidcProviderService.findByIdWithWorkspace(providerId);

      if (provider === null) {
        throw new Error('OIDC provider not found');
      }

      workspace = provider.workspace;

      this.assertProviderIsActive(provider);

      if (
        isString(workspaceInviteHash) &&
        workspaceInviteHash.length > WORKSPACE_INVITE_HASH_MAX_LENGTH
      ) {
        throw new Error('Workspace invite hash is too long');
      }

      const { authorizationUrl, state, nonce, codeVerifier } =
        await this.oidcProtocolService.startAuthorization({
          provider,
          plaintextSecret:
            this.oidcProviderService.decryptClientSecret(provider),
        });

      request.session.oidcLogins = addOidcLogin({
        logins: request.session.oidcLogins,
        login: {
          state,
          nonce,
          codeVerifier,
          providerId: provider.id,
          workspaceInviteHash: isNonEmptyString(workspaceInviteHash)
            ? workspaceInviteHash
            : null,
          createdAt: Date.now(),
        },
        maxLogins: OIDC_LOGINS_MAX_PER_SESSION,
      });

      // The redirect must not leave before Redis holds the login, or a fast IdP
      // answers into a session that does not know the state yet.
      await this.saveSession(request.session);

      return response.redirect(authorizationUrl);
    } catch (error) {
      return this.redirectWithError({ response, error, workspace });
    }
  }

  @Get(OIDC_SSO_CALLBACK_PATH)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async callback(
    @Query('state') state: unknown,
    @Req() request: OidcSessionRequest,
    @Res() response: Response,
  ) {
    let workspace: WorkspaceEntity | undefined;

    try {
      const taken = takeOidcLogin({
        logins: request.session.oidcLogins,
        state: isString(state) ? state : '',
        now: Date.now(),
        maxAgeMs: OIDC_LOGIN_MAX_AGE_MS,
      });

      // Saved before the code exchange, so a replayed callback finds nothing.
      request.session.oidcLogins = taken.remainingLogins;
      await this.saveSession(request.session);

      if (taken.status !== 'found') {
        throw new Error(`OIDC login ${taken.status}`);
      }

      const { login } = taken;

      const provider = await this.oidcProviderService.findByIdWithWorkspace(
        login.providerId,
      );

      if (provider === null) {
        throw new Error('OIDC provider not found');
      }

      workspace = provider.workspace;

      this.assertProviderIsActive(provider);

      const claims = await this.oidcProtocolService.exchangeCode({
        provider,
        plaintextSecret: this.oidcProviderService.decryptClientSecret(provider),
        requestUrl: request.originalUrl,
        login,
      });

      const identity = extractOidcIdentity(claims);

      if (identity.status === 'rejected') {
        throw new Error(`OIDC identity rejected: ${identity.reason}`);
      }

      return response.redirect(
        await this.oidcAccountService.signIn({
          provider,
          identity: identity.identity,
          claims,
          workspaceInviteHash: login.workspaceInviteHash ?? undefined,
        }),
      );
    } catch (error) {
      return this.redirectWithError({ response, error, workspace });
    }
  }

  // Only the status can fail here. The workspace binding is checked in OidcAccountService
  // against the workspace the sign-in resolves to, which an invite hash may change.
  private assertProviderIsActive(
    provider: Pick<WorkspaceOidcProviderEntity, 'workspaceId' | 'status'>,
  ) {
    const access = checkOidcProviderAccess({
      provider,
      workspaceId: provider.workspaceId,
    });

    if (access.status === 'denied') {
      throw new Error(`OIDC provider access denied: ${access.reason}`);
    }
  }

  private async saveSession(session: Session) {
    await new Promise<void>((resolve, reject) => {
      session.save((error) => (error ? reject(error) : resolve()));
    });
  }

  private redirectWithError({
    response,
    error,
    workspace,
  }: {
    response: Response;
    error: unknown;
    workspace: WorkspaceEntity | undefined;
  }) {
    // AuthService errors are written for the user; everything else (openid-client
    // messages carry state values) is logged and replaced by a generic failure.
    if (!(error instanceof AuthException)) {
      this.logger.warn(
        `OIDC sign-in failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const exception =
      error instanceof AuthException
        ? error
        : new AuthException(
            'Single sign-on authentication failed',
            AuthExceptionCode.SSO_AUTH_FAILED,
          );

    return response.redirect(
      this.guardRedirectService.getRedirectErrorUrlAndCaptureExceptions({
        error: exception,
        workspace:
          this.workspaceDomainsService.getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain(
            workspace,
          ),
        pathname: AppPath.Verify,
      }),
    );
  }
}
