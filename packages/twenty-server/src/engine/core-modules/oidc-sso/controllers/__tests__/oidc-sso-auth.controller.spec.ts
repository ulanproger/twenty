import { Logger } from '@nestjs/common';

import { AppPath } from 'twenty-shared/types';

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
const SIGNED_IN_URL = 'https://acme.example.com/verify?loginToken=token';
const GENERIC_FAILURE_MESSAGE = 'Single sign-on authentication failed';
const ERROR_REDIRECT_URL = 'https://app.example.com/verify?errorMessage=failed';
const CALLBACK_URL = '/auth/oidc-sso/callback?code=code-1&state=state-1';

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
  provider = buildProvider(),
  claims = { email: 'ada@example.com', email_verified: true },
}: {
  provider?: ReturnType<typeof buildProvider> | null;
  claims?: Record<string, unknown>;
} = {}) => {
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
    signIn: jest.fn().mockResolvedValue(SIGNED_IN_URL),
  };
  const guardRedirectService = {
    getRedirectErrorUrlAndCaptureExceptions: jest
      .fn()
      .mockReturnValue(ERROR_REDIRECT_URL),
  };
  const workspaceDomainsService = {
    getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain: jest
      .fn()
      .mockReturnValue({ subdomain: 'acme', customDomain: null }),
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
  const response = { redirect: jest.fn() };

  return {
    session,
    response,
    request: { session, originalUrl: CALLBACK_URL },
  };
};

// The controller passes the failure to the guard service, which builds the real URL.
const getRedirectedFailure = (
  guardRedirectService: ReturnType<
    typeof buildController
  >['guardRedirectService'],
) => {
  const { calls } =
    guardRedirectService.getRedirectErrorUrlAndCaptureExceptions.mock;

  expect(calls).toHaveLength(1);

  return calls[0][0] as {
    error: AuthException;
    pathname: string;
    workspace: unknown;
  };
};

describe('OidcSsoAuthController', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('login', () => {
    const login = (
      controller: OidcSsoAuthController,
      workspaceInviteHash: string | undefined,
      { request, response }: ReturnType<typeof buildRequestAndResponse>,
    ) =>
      controller.login(
        'provider-1',
        workspaceInviteHash,
        request as never,
        response as never,
      );

    it('stores the login in the session before redirecting to the IdP', async () => {
      const { controller, oidcProtocolService } = buildController();
      const http = buildRequestAndResponse();

      await login(controller, undefined, http);

      expect(oidcProtocolService.startAuthorization).toHaveBeenCalledWith({
        provider: expect.objectContaining({ id: 'provider-1' }),
        plaintextSecret: 'plaintext-secret',
      });
      expect(http.session.oidcLogins).toEqual([
        expect.objectContaining({
          state: 'state-1',
          nonce: 'nonce-1',
          codeVerifier: 'verifier-1',
          providerId: 'provider-1',
          workspaceInviteHash: null,
        }),
      ]);
      expect(http.response.redirect).toHaveBeenCalledWith(
        'https://idp.example.com/auth?state=state-1',
      );
      expect(http.session.save.mock.invocationCallOrder[0]).toBeLessThan(
        http.response.redirect.mock.invocationCallOrder[0],
      );
    });

    it('keeps the invite hash of the login, up to the length cap', async () => {
      const { controller } = buildController();
      const http = buildRequestAndResponse();
      const longestAllowedHash = 'x'.repeat(255);

      await login(controller, longestAllowedHash, http);

      expect(http.session.oidcLogins).toEqual([
        expect.objectContaining({ workspaceInviteHash: longestAllowedHash }),
      ]);
    });

    it('rejects an invite hash that is one character too long', async () => {
      const { controller, oidcProtocolService, guardRedirectService } =
        buildController();
      const http = buildRequestAndResponse();

      await login(controller, 'x'.repeat(256), http);

      expect(oidcProtocolService.startAuthorization).not.toHaveBeenCalled();
      expect(http.session.save).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Workspace invite hash is too long'),
      );
      expect(getRedirectedFailure(guardRedirectService).error.code).toBe(
        AuthExceptionCode.SSO_AUTH_FAILED,
      );
    });

    it('does not store a repeated or empty invite hash', async () => {
      const { controller } = buildController();

      for (const workspaceInviteHash of [['a', 'b'], ''] as unknown[]) {
        const http = buildRequestAndResponse();

        await controller.login(
          'provider-1',
          workspaceInviteHash,
          http.request as never,
          http.response as never,
        );

        expect(http.session.oidcLogins).toEqual([
          expect.objectContaining({ workspaceInviteHash: null }),
        ]);
      }
    });

    it('keeps only the five newest logins of the session', async () => {
      const { controller } = buildController();
      const existingLogins = [1, 2, 3, 4, 5].map((index) =>
        buildStoredLogin({ state: `old-${index}` }),
      );
      const http = buildRequestAndResponse(existingLogins);

      await login(controller, undefined, http);

      expect(http.session.oidcLogins).toEqual([
        ...existingLogins.slice(1),
        expect.objectContaining({ state: 'state-1' }),
      ]);
    });

    it('does not redirect to the IdP when the session cannot be saved', async () => {
      const { controller, guardRedirectService } = buildController();
      const http = buildRequestAndResponse();

      http.session.save.mockImplementation((callback) =>
        callback(new Error('redis down')),
      );

      await login(controller, undefined, http);

      expect(http.response.redirect).toHaveBeenCalledTimes(1);
      expect(http.response.redirect).toHaveBeenCalledWith(ERROR_REDIRECT_URL);
      expect(getRedirectedFailure(guardRedirectService).error.message).toBe(
        GENERIC_FAILURE_MESSAGE,
      );
    });

    it('rejects an unknown provider and lets the domain service pick the default workspace', async () => {
      const {
        controller,
        oidcProtocolService,
        workspaceDomainsService,
        guardRedirectService,
      } = buildController({ provider: null });

      await login(controller, undefined, buildRequestAndResponse());

      expect(oidcProtocolService.startAuthorization).not.toHaveBeenCalled();
      expect(
        workspaceDomainsService.getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain,
      ).toHaveBeenCalledWith(undefined);
      expect(getRedirectedFailure(guardRedirectService).error.code).toBe(
        AuthExceptionCode.SSO_AUTH_FAILED,
      );
    });

    it('rejects an inactive provider and redirects to its own workspace', async () => {
      const {
        controller,
        oidcProtocolService,
        workspaceDomainsService,
        guardRedirectService,
      } = buildController({ provider: buildProvider({ status: 'inactive' }) });

      await login(controller, undefined, buildRequestAndResponse());

      expect(oidcProtocolService.startAuthorization).not.toHaveBeenCalled();
      expect(
        workspaceDomainsService.getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain,
      ).toHaveBeenCalledWith(WORKSPACE);
      expect(getRedirectedFailure(guardRedirectService).pathname).toBe(
        AppPath.Verify,
      );
    });
  });

  describe('callback', () => {
    const callback = (
      controller: OidcSsoAuthController,
      { request, response }: ReturnType<typeof buildRequestAndResponse>,
      state = 'state-1',
    ) => controller.callback(state, request as never, response as never);

    it('passes the stored login to the code exchange and redirects to the signed-in url', async () => {
      const claims = {
        email: 'ada@example.com',
        email_verified: true,
        given_name: 'Ada',
      };
      const {
        controller,
        oidcProtocolService,
        oidcAccountService,
        oidcProviderService,
      } = buildController({ claims });
      const storedLogin = buildStoredLogin();
      const http = buildRequestAndResponse([storedLogin]);

      await callback(controller, http);

      expect(oidcProviderService.findByIdWithWorkspace).toHaveBeenCalledWith(
        'provider-1',
      );
      expect(oidcProtocolService.exchangeCode).toHaveBeenCalledWith({
        provider: expect.objectContaining({ id: 'provider-1' }),
        plaintextSecret: 'plaintext-secret',
        requestUrl: CALLBACK_URL,
        login: storedLogin,
      });
      expect(oidcAccountService.signIn).toHaveBeenCalledWith({
        provider: expect.objectContaining({ id: 'provider-1' }),
        identity: expect.objectContaining({ email: 'ada@example.com' }),
        claims,
        workspaceInviteHash: undefined,
      });
      expect(http.response.redirect).toHaveBeenCalledWith(SIGNED_IN_URL);
    });

    it('saves the session without the login before the code exchange', async () => {
      const { controller, oidcProtocolService } = buildController();
      const http = buildRequestAndResponse([buildStoredLogin()]);

      await callback(controller, http);

      expect(http.session.oidcLogins).toEqual([]);
      expect(http.session.save.mock.invocationCallOrder[0]).toBeLessThan(
        oidcProtocolService.exchangeCode.mock.invocationCallOrder[0],
      );
    });

    it('leaves the other pending logins of the session alone', async () => {
      const { controller } = buildController();
      const otherLogin = buildStoredLogin({ state: 'other-tab' });
      const http = buildRequestAndResponse([buildStoredLogin(), otherLogin]);

      await callback(controller, http);

      expect(http.session.oidcLogins).toEqual([otherLogin]);
    });

    it('does not exchange the code when the session cannot be saved', async () => {
      const { controller, oidcProtocolService, guardRedirectService } =
        buildController();
      const http = buildRequestAndResponse([buildStoredLogin()]);

      http.session.save.mockImplementation((saveCallback) =>
        saveCallback(new Error('redis down')),
      );

      await callback(controller, http);

      expect(oidcProtocolService.exchangeCode).not.toHaveBeenCalled();
      expect(getRedirectedFailure(guardRedirectService).error.message).toBe(
        GENERIC_FAILURE_MESSAGE,
      );
    });

    it('treats a repeated state parameter as an unknown state', async () => {
      const { controller, oidcProtocolService, guardRedirectService } =
        buildController();
      const http = buildRequestAndResponse([buildStoredLogin()]);

      await controller.callback(
        ['state-1', 'state-1'],
        http.request as never,
        http.response as never,
      );

      expect(oidcProtocolService.exchangeCode).not.toHaveBeenCalled();
      expect(getRedirectedFailure(guardRedirectService).error.code).toBe(
        AuthExceptionCode.SSO_AUTH_FAILED,
      );
    });

    it('hands the invite hash of the login to the sign-in', async () => {
      const { controller, oidcAccountService } = buildController();
      const http = buildRequestAndResponse([
        buildStoredLogin({ workspaceInviteHash: 'invite-hash' }),
      ]);

      await callback(controller, http);

      expect(oidcAccountService.signIn).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceInviteHash: 'invite-hash' }),
      );
    });

    it('rejects a replayed callback because the login is gone from the session', async () => {
      const {
        controller,
        oidcProviderService,
        oidcProtocolService,
        guardRedirectService,
      } = buildController();
      const http = buildRequestAndResponse([buildStoredLogin()]);

      await callback(controller, http);
      await callback(controller, http);

      expect(http.response.redirect).toHaveBeenNthCalledWith(1, SIGNED_IN_URL);
      expect(
        guardRedirectService.getRedirectErrorUrlAndCaptureExceptions,
      ).toHaveBeenCalledTimes(1);
      expect(oidcProviderService.findByIdWithWorkspace).toHaveBeenCalledTimes(
        1,
      );
      expect(oidcProtocolService.exchangeCode).toHaveBeenCalledTimes(1);
    });

    it('does not touch the session or the IdP for an unknown state', async () => {
      const {
        controller,
        workspaceDomainsService,
        oidcProviderService,
        oidcProtocolService,
        guardRedirectService,
      } = buildController();
      const http = buildRequestAndResponse([buildStoredLogin()]);

      await callback(controller, http, 'other-state');

      expect(
        workspaceDomainsService.getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain,
      ).toHaveBeenCalledWith(undefined);
      expect(getRedirectedFailure(guardRedirectService).error.code).toBe(
        AuthExceptionCode.SSO_AUTH_FAILED,
      );
      expect(http.session.save).not.toHaveBeenCalled();
      expect(oidcProviderService.findByIdWithWorkspace).not.toHaveBeenCalled();
      expect(oidcProtocolService.exchangeCode).not.toHaveBeenCalled();
    });

    it('accepts a login that is nearly at the age limit', async () => {
      const { controller, oidcProtocolService } = buildController();
      const http = buildRequestAndResponse([
        buildStoredLogin({ createdAt: Date.now() - 9 * 60 * 1000 }),
      ]);

      await callback(controller, http);

      expect(oidcProtocolService.exchangeCode).toHaveBeenCalledTimes(1);
    });

    it('drops an expired login from the session and rejects it', async () => {
      const {
        controller,
        oidcProviderService,
        oidcProtocolService,
        guardRedirectService,
      } = buildController();
      const http = buildRequestAndResponse([
        buildStoredLogin({ createdAt: Date.now() - 11 * 60 * 1000 }),
      ]);

      await callback(controller, http);

      expect(getRedirectedFailure(guardRedirectService).error.code).toBe(
        AuthExceptionCode.SSO_AUTH_FAILED,
      );
      expect(http.session.oidcLogins).toEqual([]);
      expect(http.session.save).toHaveBeenCalledTimes(1);
      expect(oidcProviderService.findByIdWithWorkspace).not.toHaveBeenCalled();
      expect(oidcProtocolService.exchangeCode).not.toHaveBeenCalled();
    });

    it('rejects a provider deactivated after the login started', async () => {
      const {
        controller,
        oidcProviderService,
        oidcProtocolService,
        guardRedirectService,
      } = buildController({ provider: buildProvider({ status: 'inactive' }) });
      const http = buildRequestAndResponse([buildStoredLogin()]);

      await callback(controller, http);

      expect(oidcProviderService.findByIdWithWorkspace).toHaveBeenCalledWith(
        'provider-1',
      );
      expect(oidcProtocolService.exchangeCode).not.toHaveBeenCalled();
      expect(getRedirectedFailure(guardRedirectService).error.code).toBe(
        AuthExceptionCode.SSO_AUTH_FAILED,
      );
    });

    it.each([
      ['unverified', { email: 'ada@example.com', email_verified: false }],
      ['without an email_verified claim', { email: 'ada@example.com' }],
    ])(
      'rejects an email that is %s after the exchange, without signing in',
      async (_label, claims) => {
        const {
          controller,
          oidcProtocolService,
          oidcAccountService,
          guardRedirectService,
        } = buildController({ claims });
        const http = buildRequestAndResponse([buildStoredLogin()]);

        await callback(controller, http);

        expect(oidcProtocolService.exchangeCode).toHaveBeenCalledTimes(1);
        expect(oidcAccountService.signIn).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('OIDC identity rejected'),
        );

        const { error } = getRedirectedFailure(guardRedirectService);

        expect(error.code).toBe(AuthExceptionCode.SSO_AUTH_FAILED);
        expect(error.message).toBe(GENERIC_FAILURE_MESSAGE);
      },
    );

    it('replaces the message of an IdP library error with the generic failure', async () => {
      const {
        controller,
        oidcProtocolService,
        guardRedirectService,
        workspaceDomainsService,
      } = buildController();

      oidcProtocolService.exchangeCode.mockRejectedValue(
        new Error('state mismatch: expected state-1'),
      );

      const http = buildRequestAndResponse([buildStoredLogin()]);

      await callback(controller, http);

      const { error, pathname } = getRedirectedFailure(guardRedirectService);

      expect(http.response.redirect).toHaveBeenCalledWith(ERROR_REDIRECT_URL);
      expect(
        workspaceDomainsService.getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain,
      ).toHaveBeenCalledWith(WORKSPACE);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('state mismatch: expected state-1'),
      );

      expect(error).toBeInstanceOf(AuthException);
      expect(error.code).toBe(AuthExceptionCode.SSO_AUTH_FAILED);
      expect(error.message).toBe(GENERIC_FAILURE_MESSAGE);
      expect(pathname).toBe(AppPath.Verify);
    });

    it('keeps an AuthException from the sign-in pipeline as it is', async () => {
      const { controller, oidcAccountService, guardRedirectService } =
        buildController();
      const signUpDisabled = new AuthException(
        'no signup',
        AuthExceptionCode.SIGNUP_DISABLED,
      );

      oidcAccountService.signIn.mockRejectedValue(signUpDisabled);

      await callback(controller, buildRequestAndResponse([buildStoredLogin()]));

      expect(getRedirectedFailure(guardRedirectService).error).toBe(
        signUpDisabled,
      );
    });
  });
});
