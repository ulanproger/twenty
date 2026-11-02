import { buildOidcAuthorizationParams } from 'src/engine/core-modules/oidc-sso/utils/build-oidc-authorization-params.util';

describe('buildOidcAuthorizationParams', () => {
  it('fixes the protocol constants and passes through the per-request values', () => {
    expect(
      buildOidcAuthorizationParams({
        callbackUrl: 'https://crm.example.com/auth/oidc-sso/callback',
        state: 'state-1',
        nonce: 'nonce-1',
        codeChallenge: 'challenge-1',
      }),
    ).toEqual({
      response_type: 'code',
      response_mode: 'query',
      scope: 'openid email profile',
      redirect_uri: 'https://crm.example.com/auth/oidc-sso/callback',
      state: 'state-1',
      nonce: 'nonce-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
    });
  });
});
