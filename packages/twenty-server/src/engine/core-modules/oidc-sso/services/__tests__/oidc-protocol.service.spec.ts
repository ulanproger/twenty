import { Issuer } from 'openid-client';

import { OidcProtocolService } from 'src/engine/core-modules/oidc-sso/services/oidc-protocol.service';
import { type SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const ISSUER = 'https://idp.example.com/realms/main';

const discoveryDocument = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/auth`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/jwks`,
  code_challenge_methods_supported: ['S256'],
};

const credentials = {
  provider: { issuer: ISSUER, clientId: 'client-1' },
  plaintextSecret: 'secret-1',
};

const buildService = (document: unknown = discoveryDocument) => {
  const get = jest.fn().mockResolvedValue({ data: document });
  const secureHttpClientService = {
    getHttpClient: jest.fn(() => ({ get })),
    getSsrfSafeAgent: jest.fn(),
  } as unknown as SecureHttpClientService;
  const twentyConfigService = {
    get: jest.fn(() => 'http://localhost:3000'),
  } as unknown as TwentyConfigService;

  return {
    get,
    service: new OidcProtocolService(
      secureHttpClientService,
      twentyConfigService,
    ),
  };
};

describe('OidcProtocolService', () => {
  describe('startAuthorization', () => {
    it('builds an authorization request with PKCE, state and nonce', async () => {
      const { service } = buildService();

      const { authorizationUrl, state, nonce, codeVerifier } =
        await service.startAuthorization(credentials);

      const url = new URL(authorizationUrl);

      expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/auth`);
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        client_id: 'client-1',
        response_type: 'code',
        response_mode: 'query',
        scope: 'openid email profile',
        redirect_uri: 'http://localhost:3000/auth/oidc-sso/callback',
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      expect(url.searchParams.get('code_challenge')).toEqual(
        expect.any(String),
      );
      expect(codeVerifier).not.toBe(url.searchParams.get('code_challenge'));
    });

    it('generates fresh secrets for every login', async () => {
      const { service } = buildService();

      const first = await service.startAuthorization(credentials);
      const second = await service.startAuthorization(credentials);

      expect(first.state).not.toBe(second.state);
      expect(first.nonce).not.toBe(second.nonce);
      expect(first.codeVerifier).not.toBe(second.codeVerifier);
    });

    it('fetches the discovery document once and reuses it', async () => {
      const { service, get } = buildService();

      await service.startAuthorization(credentials);
      await service.startAuthorization(credentials);

      expect(get).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith(
        `${ISSUER}/.well-known/openid-configuration`,
      );
    });

    it('shares one discovery request between concurrent logins', async () => {
      const { service, get } = buildService();

      await Promise.all([
        service.startAuthorization(credentials),
        service.startAuthorization(credentials),
        service.startAuthorization(credentials),
      ]);

      expect(get).toHaveBeenCalledTimes(1);
    });

    it('rejects a discovery document that names another issuer', async () => {
      const { service } = buildService({
        ...discoveryDocument,
        issuer: 'https://evil.example.com',
      });

      await expect(service.startAuthorization(credentials)).rejects.toThrow(
        'OIDC discovery rejected: issuer-mismatch',
      );
    });

    it('does not cache a rejected discovery document', async () => {
      const { service, get } = buildService({
        ...discoveryDocument,
        issuer: 'https://evil.example.com',
      });

      await expect(service.startAuthorization(credentials)).rejects.toThrow();
      await expect(service.startAuthorization(credentials)).rejects.toThrow();

      expect(get).toHaveBeenCalledTimes(2);
    });

    it('rejects a discovery response that is not a JSON object', async () => {
      const { service } = buildService('<html>login</html>');

      await expect(service.startAuthorization(credentials)).rejects.toThrow(
        'OIDC discovery document is not a JSON object',
      );
    });
  });

  describe('exchangeCode', () => {
    const login = {
      state: 'state-1',
      nonce: 'nonce-1',
      codeVerifier: 'verifier-1',
    };
    const requestUrl =
      '/auth/oidc-sso/callback?code=code-1&state=state-1&session_state=ignored';

    // Every client class extends one BaseClient, so patching its prototype
    // intercepts the network calls without touching the code under test.
    const baseClientPrototype = Object.getPrototypeOf(
      new Issuer({ issuer: ISSUER }).Client.prototype,
    );

    const mockTokenEndpoint = (idTokenClaims: Record<string, unknown>) =>
      jest
        .spyOn(baseClientPrototype, 'callback')
        .mockResolvedValue({ claims: () => idTokenClaims });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('verifies the response against the stored login and returns the id_token claims', async () => {
      const callback = mockTokenEndpoint({
        sub: 'sub-1',
        email: 'ada@example.com',
      });
      const userinfo = jest.spyOn(baseClientPrototype, 'userinfo');
      const { service } = buildService({
        ...discoveryDocument,
        userinfo_endpoint: `${ISSUER}/userinfo`,
      });

      await expect(
        service.exchangeCode({ ...credentials, requestUrl, login }),
      ).resolves.toEqual({ sub: 'sub-1', email: 'ada@example.com' });

      expect(callback).toHaveBeenCalledWith(
        'http://localhost:3000/auth/oidc-sso/callback',
        expect.objectContaining({ code: 'code-1', state: 'state-1' }),
        {
          state: 'state-1',
          nonce: 'nonce-1',
          code_verifier: 'verifier-1',
          response_type: 'code',
        },
      );
      expect(userinfo).not.toHaveBeenCalled();
    });

    it('asks the userinfo endpoint when the id_token has no email', async () => {
      const tokenSet = { claims: () => ({ sub: 'sub-1' }) };
      jest.spyOn(baseClientPrototype, 'callback').mockResolvedValue(tokenSet);
      const userinfo = jest
        .spyOn(baseClientPrototype, 'userinfo')
        .mockResolvedValue({ sub: 'other', email: 'ada@example.com' });
      const { service } = buildService({
        ...discoveryDocument,
        userinfo_endpoint: `${ISSUER}/userinfo`,
      });

      // The TokenSet (not a bare access token) is what lets openid-client compare sub values.
      await expect(
        service.exchangeCode({ ...credentials, requestUrl, login }),
      ).resolves.toEqual({ sub: 'sub-1', email: 'ada@example.com' });

      expect(userinfo).toHaveBeenCalledWith(tokenSet);
    });

    it('does not call userinfo when the IdP has no such endpoint', async () => {
      mockTokenEndpoint({ sub: 'sub-1' });
      const userinfo = jest.spyOn(baseClientPrototype, 'userinfo');
      const { service } = buildService();

      await expect(
        service.exchangeCode({ ...credentials, requestUrl, login }),
      ).resolves.toEqual({ sub: 'sub-1' });

      expect(userinfo).not.toHaveBeenCalled();
    });

    it('does not call userinfo when the email is present but unverified', async () => {
      mockTokenEndpoint({
        sub: 'sub-1',
        email: 'ada@example.com',
        email_verified: false,
      });
      const userinfo = jest.spyOn(baseClientPrototype, 'userinfo');
      const { service } = buildService({
        ...discoveryDocument,
        userinfo_endpoint: `${ISSUER}/userinfo`,
      });

      await service.exchangeCode({ ...credentials, requestUrl, login });

      expect(userinfo).not.toHaveBeenCalled();
    });

    // openid-client falls back to client_secret_post on its own; this pins that
    // behaviour so setting the method explicitly later cannot break such IdPs.
    // The request itself is checked by scripts/fork/oidc-dev/check-client-auth-method.cjs.
    describe('token endpoint authentication method', () => {
      const exchangeAndReadAuthMethod = async (
        supportedMethods: string[] | undefined,
      ) => {
        const callback = mockTokenEndpoint({ sub: 'sub-1' });
        const { service } = buildService({
          ...discoveryDocument,
          ...(supportedMethods !== undefined && {
            token_endpoint_auth_methods_supported: supportedMethods,
          }),
        });

        await service.exchangeCode({ ...credentials, requestUrl, login });

        return callback.mock.contexts[0].token_endpoint_auth_method;
      };

      it.each([
        [
          'uses basic when methods are missing',
          undefined,
          'client_secret_basic',
        ],
        ['uses basic when methods are empty', [], 'client_secret_basic'],
        [
          'uses basic when basic is listed',
          ['client_secret_basic'],
          'client_secret_basic',
        ],
        [
          'uses basic when both are listed',
          ['client_secret_post', 'client_secret_basic'],
          'client_secret_basic',
        ],
        [
          'uses post when only post is listed',
          ['client_secret_post'],
          'client_secret_post',
        ],
      ])('%s', async (_title, methods, expected) => {
        await expect(exchangeAndReadAuthMethod(methods)).resolves.toBe(
          expected,
        );
      });
    });
  });
});
