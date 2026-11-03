import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { custom, generators, Issuer, type IssuerMetadata } from 'openid-client';
import { isPlainObject } from 'twenty-shared/utils';

import { OidcSsoException } from 'src/engine/core-modules/oidc-sso/oidc-sso.exception';
import { type WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import { type OidcLogin } from 'src/engine/core-modules/oidc-sso/utils/oidc-login-session.util';
import { buildOidcAuthorizationParams } from 'src/engine/core-modules/oidc-sso/utils/build-oidc-authorization-params.util';
import { buildOidcCallbackUrl } from 'src/engine/core-modules/oidc-sso/utils/build-oidc-callback-url.util';
import { extractOidcIdentity } from 'src/engine/core-modules/oidc-sso/utils/extract-oidc-identity.util';
import { pickOidcIdTokenSigningAlgorithm } from 'src/engine/core-modules/oidc-sso/utils/pick-oidc-id-token-signing-algorithm.util';
import { validateOidcDiscoveryMetadata } from 'src/engine/core-modules/oidc-sso/utils/validate-oidc-discovery-metadata.util';
import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1000;
// openid-client defaults to 3.5s, too short for slow IdP token endpoints.
const IDP_REQUEST_TIMEOUT_MS = 10_000;

type ProviderCredentials = {
  provider: Pick<WorkspaceOidcProviderEntity, 'issuer' | 'clientId'>;
  plaintextSecret: string;
};

@Injectable()
export class OidcProtocolService {
  private readonly logger = new Logger(OidcProtocolService.name);

  // Holds the promise so concurrent logins share one discovery request.
  private readonly discoveryCache = new Map<
    string,
    { issuer: Promise<Issuer>; expiresAt: number }
  >();

  constructor(
    private readonly secureHttpClientService: SecureHttpClientService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async startAuthorization(credentials: ProviderCredentials) {
    const client = await this.buildClient(credentials);

    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();

    const authorizationUrl = client.authorizationUrl(
      buildOidcAuthorizationParams({
        callbackUrl: this.getCallbackUrl(),
        state,
        nonce,
        codeChallenge: generators.codeChallenge(codeVerifier),
      }),
    );

    return { authorizationUrl, state, nonce, codeVerifier };
  }

  // openid-client verifies state, nonce, iss, the id_token signature and PKCE here.
  async exchangeCode({
    requestUrl,
    login,
    ...credentials
  }: ProviderCredentials & {
    requestUrl: string;
    login: Pick<OidcLogin, 'state' | 'nonce' | 'codeVerifier'>;
  }): Promise<Record<string, unknown>> {
    const client = await this.buildClient(credentials);

    const tokenSet = await client.callback(
      this.getCallbackUrl(),
      client.callbackParams(requestUrl),
      {
        state: login.state,
        nonce: login.nonce,
        code_verifier: login.codeVerifier,
        response_type: 'code',
      },
    );

    const idTokenClaims: Record<string, unknown> = { ...tokenSet.claims() };

    const identity = extractOidcIdentity(idTokenClaims);

    // Some IdPs leave email out of the id_token, so userinfo must then supply email
    // and email_verified. Passing the TokenSet makes openid-client check that the
    // userinfo sub matches the id_token sub.
    if (
      identity.status === 'rejected' &&
      identity.reason === 'email-missing' &&
      isNonEmptyString(client.issuer.userinfo_endpoint)
    ) {
      return { ...(await client.userinfo(tokenSet)), ...idTokenClaims };
    }

    return idTokenClaims;
  }

  // Bypasses the cache so a fresh IdP configuration is what gets validated.
  async assertIssuerDiscoverable(issuerUrl: string): Promise<void> {
    try {
      await this.fetchIssuer(issuerUrl);
    } catch (error) {
      // The cause stays in the log: network error texts must not reach the client.
      this.logger.warn(
        `OIDC discovery failed for ${issuerUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );

      throw new OidcSsoException(
        `OIDC discovery failed for ${issuerUrl}`,
        'ISSUER_DISCOVERY_FAILED',
      );
    }
  }

  private getCallbackUrl(): string {
    return buildOidcCallbackUrl(this.twentyConfigService.get('SERVER_URL'));
  }

  private readonly idpHttpOptions = (url: URL) => ({
    agent: this.secureHttpClientService.getSsrfSafeAgent(url),
    timeout: IDP_REQUEST_TIMEOUT_MS,
  });

  private async buildClient({
    provider,
    plaintextSecret,
  }: ProviderCredentials) {
    const issuer = await this.discoverIssuer(provider.issuer);

    const idTokenSigningAlgorithm = pickOidcIdTokenSigningAlgorithm(
      issuer.metadata,
    );

    const client = new issuer.Client({
      client_id: provider.clientId,
      client_secret: plaintextSecret,
      redirect_uris: [this.getCallbackUrl()],
      response_types: ['code'],
      ...(idTokenSigningAlgorithm !== undefined && {
        id_token_signed_response_alg: idTokenSigningAlgorithm,
      }),
    });

    client[custom.http_options] = this.idpHttpOptions;

    return client;
  }

  // Fetched here instead of Issuer.discover so the request gets the secure client's
  // size limit and SSRF-safe agent without touching openid-client's global hooks.
  private discoverIssuer(issuerUrl: string): Promise<Issuer> {
    const cached = this.discoveryCache.get(issuerUrl);

    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return cached.issuer;
    }

    const issuer = this.fetchIssuer(issuerUrl);

    for (const [cachedUrl, entry] of this.discoveryCache) {
      if (entry.expiresAt <= Date.now()) {
        this.discoveryCache.delete(cachedUrl);
      }
    }

    this.discoveryCache.set(issuerUrl, {
      issuer,
      expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
    });

    // A failed discovery must not stay cached.
    issuer.catch(() => {
      if (this.discoveryCache.get(issuerUrl)?.issuer === issuer) {
        this.discoveryCache.delete(issuerUrl);
      }
    });

    return issuer;
  }

  private async fetchIssuer(issuerUrl: string): Promise<Issuer> {
    const { data } = await this.secureHttpClientService
      .getHttpClient({ timeout: IDP_REQUEST_TIMEOUT_MS })
      .get<unknown>(`${issuerUrl}/.well-known/openid-configuration`);

    if (!isPlainObject(data)) {
      throw new Error('OIDC discovery document is not a JSON object');
    }

    const validation = validateOidcDiscoveryMetadata({
      expectedIssuer: issuerUrl,
      metadata: data,
    });

    if (validation.status === 'invalid') {
      throw new Error(`OIDC discovery rejected: ${validation.reason}`);
    }

    // validateOidcDiscoveryMetadata has just confirmed the required fields.
    const issuer = new Issuer(data as IssuerMetadata);

    issuer[custom.http_options] = this.idpHttpOptions;

    return issuer;
  }
}
