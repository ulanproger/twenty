import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { type WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { type GuardRedirectService } from 'src/engine/core-modules/guard-redirect/services/guard-redirect.service';
import { OidcSsoAuthController } from 'src/engine/core-modules/oidc-sso/controllers/oidc-sso-auth.controller';
import { type OidcAccountService } from 'src/engine/core-modules/oidc-sso/services/oidc-account.service';
import { type OidcProtocolService } from 'src/engine/core-modules/oidc-sso/services/oidc-protocol.service';
import { type OidcProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-provider.service';

const WORKSPACE = { id: 'workspace-a', subdomain: 'acme' };

const buildProvider = (overrides: Record<string, unknown> = {}) => ({
  id: 'provider-1',
  workspaceId: WORKSPACE.id,
  status: 'active',
  workspace: WORKSPACE,
  ...overrides,
});

const buildStoredLogin = (overrides: Record<string, unknown> = {}) => ({
  state: 'state-1',
  nonce: 'nonce-1',
  codeVerifier: 'verifier-1',
  providerId: 'provider-1',
  workspaceInviteHash: null,
  createdAt: Date.now(),
  ...overrides,
});

const buildController = ({
  provider = buildProvider() as unknown,
  claims = { email: 'ada@example.com' } as Record<string, unknown>,
}: { provider?: unknown; claims?: Record<string, unknown> } = {}) => {
  const oidcProviderService = {
    findByIdWithWorkspace: jest.fn().mockResolvedValue(provider),
    decryptClientSecret: jest.fn().mockReturnValue('plaintext-secret'),
  };
  const oidcProtocolService = {
    startAuthorization: jest.fn().mockResolvedValue({
      authorizationUrl: 'https://idp.example.com/auth?state=state-1',
      state: 'state-1',
      nonce: 'nonce-1',
      codeVerifier: 'verifier-1',
    }),
    exchangeCode: jest.fn().mockResolvedValue(claims),
  };
  const oidcAccountService = {
    signIn: jest
      .fn()
      .mockResolvedValue('https://acme.example.com/verify?loginToken=token'),
  };
  const guardRedirectService = {
    getRedirectErrorUrlAndCaptureExceptions: jest.fn(
      ({ error }: { error: AuthException }) =>
        `https://app.example.com/verify?errorCode=${error.code}`,
    ),
  };
  const workspaceDomainsService = {
    getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain: jest.fn(
      (workspace?: { subdomain: string }) => ({
        subdomain: workspace?.subdomain ?? 'default',
        customDomain: null,
      }),
    ),
  };

  return {
    oidcProviderService,
    oidcProtocolService,
    oidcAccountService,
    guardRedirectService,
    workspaceDomainsService,
    controller: new OidcSsoAuthController(
      oidcProviderService as unknown as OidcProviderService,
      oidcProtocolService as unknown as OidcProtocolService,
      oidcAccountService as unknown as OidcAccountService,
      guardRedirectService as unknown as GuardRedirectService,
      workspaceDomainsService as unknown as WorkspaceDomainsService,
    ),
  };
};

const buildRequestAndResponse = (oidcLogins?: unknown[]) => {
  const session = {
    oidcLogins,
    save: jest.fn((callback: (error?: Error) => void) => callback()),
  };

  return {
    session,
    request: {
      session,
      originalUrl: '/auth/oidc-sso/callback?code=code-1&state=state-1',
    } as never,
    response: { redirect: jest.fn() } as never,
    redirect: (response: never) =>
      (response as { redirect: jest.Mock }).redirect,
  };
};

const errorCodeRedirected = (redirect: jest.Mock) =>
  new URL(redirect.mock.calls[0][0]).searchParams.get('errorCode');

describe('OidcSsoAuthController', () => {
  describe('login', () => {
    it('stores the login in the session before redirecting to the IdP', async () => {
      const { controller, oidcProtocolService } = buildController();
      const { request, response, session, redirect } =
        buildRequestAndResponse();

      await controller.login('provider-1', undefined, request, response);

      expect(oidcProtocolService.startAuthorization).toHaveBeenCalledWith({
        provider: expect.objectContaining({ id: 'provider-1' }),
        plaintextSecret: 'plaintext-secret',
      });
      expect(session.oidcLogins).toEqual([
        expect.objectContaining({
          state: 'state-1',
          providerId: 'provider-1',
          workspaceInviteHash: null,
        }),
      ]);
      expect(redirect(response)).toHaveBeenCalledWith(
        'https://idp.example.com/auth?state=state-1',
      );
      expect(session.save.mock.invocationCallOrder[0]).toBeLessThan(
        redirect(response).mock.invocationCallOrder[0],
      );
    });

    it('keeps the invite hash of the login', async () => {
      const { controller } = buildController();
      const { request, response, session } = buildRequestAndResponse();

      await controller.login('provider-1', 'invite-hash', request, response);

      expect(session.oidcLogins).toEqual([
        expect.objectContaining({ workspaceInviteHash: 'invite-hash' }),
      ]);
    });

    it('rejects an unknown provider and redirects to the default workspace', async () => {
      const { controller, workspaceDomainsService, oidcProtocolService } =
        buildController({ provider: null });
      const { request, response, redirect } = buildRequestAndResponse();

      await controller.login('provider-1', undefined, request, response);

      expect(errorCodeRedirected(redirect(response))).toBe('SSO_AUTH_FAILED');
      expect(
        workspaceDomainsService.getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain,
      ).toHaveBeenCalledWith(undefined);
      expect(oidcProtocolService.startAuthorization).not.toHaveBeenCalled();
    });

    it('rejects an inactive provider and redirects to its own workspace', async () => {
      const { controller, workspaceDomainsService, oidcProtocolService } =
        buildController({ provider: buildProvider({ status: 'inactive' }) });
      const { request, response, redirect } = buildRequestAndResponse();

      await controller.login('provider-1', undefined, request, response);

      expect(errorCodeRedirected(redirect(response))).toBe('SSO_AUTH_FAILED');
      expect(
        workspaceDomainsService.getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain,
      ).toHaveBeenCalledWith(WORKSPACE);
      expect(oidcProtocolService.startAuthorization).not.toHaveBeenCalled();
    });

    it('rejects an invite hash that is too long for the session', async () => {
      const { controller, oidcProtocolService } = buildController();
      const { request, response, session, redirect } =
        buildRequestAndResponse();

      await controller.login('provider-1', 'x'.repeat(256), request, response);

      expect(errorCodeRedirected(redirect(response))).toBe('SSO_AUTH_FAILED');
      expect(oidcProtocolService.startAuthorization).not.toHaveBeenCalled();
      expect(session.save).not.toHaveBeenCalled();
    });
  });

  describe('callback', () => {
    it('saves the session before the code exchange and redirects to the signed-in url', async () => {
      const { controller, oidcProtocolService, oidcAccountService } =
        buildController();
      const { request, response, session, redirect } = buildRequestAndResponse([
        buildStoredLogin({ workspaceInviteHash: 'invite-hash' }),
      ]);

      await controller.callback('state-1', request, response);

      expect(session.oidcLogins).toEqual([]);
      expect(session.save.mock.invocationCallOrder[0]).toBeLessThan(
        oidcProtocolService.exchangeCode.mock.invocationCallOrder[0],
      );
      expect(oidcAccountService.signIn).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceInviteHash: 'invite-hash' }),
      );
      expect(redirect(response)).toHaveBeenCalledWith(
        'https://acme.example.com/verify?loginToken=token',
      );
    });

    it('rejects a replayed callback', async () => {
      const { controller, oidcProtocolService } = buildController();
      const { request, response, redirect } = buildRequestAndResponse([
        buildStoredLogin(),
      ]);

      await controller.callback('state-1', request, response);
      await controller.callback('state-1', request, response);

      const [firstRedirect, secondRedirect] = redirect(response).mock.calls.map(
        ([url]: [string]) => url,
      );

      expect(firstRedirect).toBe(
        'https://acme.example.com/verify?loginToken=token',
      );
      expect(new URL(secondRedirect).searchParams.get('errorCode')).toBe(
        'SSO_AUTH_FAILED',
      );
      expect(oidcProtocolService.exchangeCode).toHaveBeenCalledTimes(1);
    });

    it('does not touch the session or the IdP for an unknown state', async () => {
      const { controller, oidcProtocolService } = buildController();
      const { request, response, session, redirect } = buildRequestAndResponse([
        buildStoredLogin(),
      ]);

      await controller.callback('other-state', request, response);

      expect(errorCodeRedirected(redirect(response))).toBe('SSO_AUTH_FAILED');
      expect(session.save).not.toHaveBeenCalled();
      expect(oidcProtocolService.exchangeCode).not.toHaveBeenCalled();
    });

    it('drops an expired login from the session and rejects it', async () => {
      const { controller, oidcProtocolService } = buildController();
      const { request, response, session, redirect } = buildRequestAndResponse([
        buildStoredLogin({ createdAt: Date.now() - 11 * 60 * 1000 }),
      ]);

      await controller.callback('state-1', request, response);

      expect(errorCodeRedirected(redirect(response))).toBe('SSO_AUTH_FAILED');
      expect(session.oidcLogins).toEqual([]);
      expect(session.save).toHaveBeenCalledTimes(1);
      expect(oidcProtocolService.exchangeCode).not.toHaveBeenCalled();
    });

    it('rejects an inactive provider before the code exchange', async () => {
      const { controller, oidcProtocolService } = buildController({
        provider: buildProvider({ status: 'inactive' }),
      });
      const { request, response, redirect } = buildRequestAndResponse([
        buildStoredLogin(),
      ]);

      await controller.callback('state-1', request, response);

      expect(errorCodeRedirected(redirect(response))).toBe('SSO_AUTH_FAILED');
      expect(oidcProtocolService.exchangeCode).not.toHaveBeenCalled();
    });

    it('rejects an unverified email without signing in', async () => {
      const { controller, oidcAccountService } = buildController({
        claims: { email: 'ada@example.com', email_verified: false },
      });
      const { request, response, redirect } = buildRequestAndResponse([
        buildStoredLogin(),
      ]);

      await controller.callback('state-1', request, response);

      expect(errorCodeRedirected(redirect(response))).toBe('SSO_AUTH_FAILED');
      expect(oidcAccountService.signIn).not.toHaveBeenCalled();
    });

    it('hides the message of an IdP library error behind SSO_AUTH_FAILED', async () => {
      const { controller, oidcProtocolService, guardRedirectService } =
        buildController();
      oidcProtocolService.exchangeCode.mockRejectedValue(
        new Error('state mismatch: expected state-1'),
      );
      const { request, response } = buildRequestAndResponse([
        buildStoredLogin(),
      ]);

      await controller.callback('state-1', request, response);

      const { error } =
        guardRedirectService.getRedirectErrorUrlAndCaptureExceptions.mock
          .calls[0][0];

      expect(error).toBeInstanceOf(AuthException);
      expect(error.code).toBe(AuthExceptionCode.SSO_AUTH_FAILED);
      expect(error.message).not.toContain('state-1');
    });

    it('keeps the code of an AuthException from the sign-in pipeline', async () => {
      const { controller, oidcAccountService } = buildController();
      oidcAccountService.signIn.mockRejectedValue(
        new AuthException('no signup', AuthExceptionCode.SIGNUP_DISABLED),
      );
      const { request, response, redirect } = buildRequestAndResponse([
        buildStoredLogin(),
      ]);

      await controller.callback('state-1', request, response);

      expect(errorCodeRedirected(redirect(response))).toBe('SIGNUP_DISABLED');
    });
  });
});
