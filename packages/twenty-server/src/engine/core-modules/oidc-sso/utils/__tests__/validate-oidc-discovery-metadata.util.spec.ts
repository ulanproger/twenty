import { validateOidcDiscoveryMetadata } from 'src/engine/core-modules/oidc-sso/utils/validate-oidc-discovery-metadata.util';

const validMetadata = {
  issuer: 'https://idp.example.com/realms/main',
  authorization_endpoint: 'https://idp.example.com/auth',
  token_endpoint: 'https://idp.example.com/token',
  jwks_uri: 'https://idp.example.com/jwks',
};

describe('validateOidcDiscoveryMetadata', () => {
  it.each([
    ['plain document', validMetadata],
    [
      'S256 among methods',
      { ...validMetadata, code_challenge_methods_supported: ['plain', 'S256'] },
    ],
    [
      'trailing slash in the document',
      { ...validMetadata, issuer: 'https://idp.example.com/realms/main/' },
    ],
  ])('accepts %s', (_label, metadata) => {
    expect(
      validateOidcDiscoveryMetadata({
        expectedIssuer: 'https://idp.example.com/realms/main',
        metadata,
      }),
    ).toEqual({ status: 'valid' });
  });

  it('accepts a document without trailing slash for an expected issuer with one', () => {
    expect(
      validateOidcDiscoveryMetadata({
        expectedIssuer: 'https://idp.example.com/realms/main/',
        metadata: validMetadata,
      }),
    ).toEqual({ status: 'valid' });
  });

  it.each([
    ['other issuer', { ...validMetadata, issuer: 'https://evil.example.com' }],
    ['missing issuer', { ...validMetadata, issuer: undefined }],
    ['non-string issuer', { ...validMetadata, issuer: 5 }],
  ])('rejects %s', (_label, metadata) => {
    expect(
      validateOidcDiscoveryMetadata({
        expectedIssuer: 'https://idp.example.com/realms/main',
        metadata,
      }),
    ).toEqual({ status: 'invalid', reason: 'issuer-mismatch' });
  });

  it.each(['authorization_endpoint', 'token_endpoint', 'jwks_uri'])(
    'rejects a document without %s',
    (missingKey) => {
      expect(
        validateOidcDiscoveryMetadata({
          expectedIssuer: 'https://idp.example.com/realms/main',
          metadata: { ...validMetadata, [missingKey]: undefined },
        }),
      ).toEqual({ status: 'invalid', reason: 'endpoint-missing' });
    },
  );

  it('rejects an IdP that does not support S256', () => {
    expect(
      validateOidcDiscoveryMetadata({
        expectedIssuer: 'https://idp.example.com/realms/main',
        metadata: {
          ...validMetadata,
          code_challenge_methods_supported: ['plain'],
        },
      }),
    ).toEqual({ status: 'invalid', reason: 'pkce-s256-unsupported' });
  });
});
