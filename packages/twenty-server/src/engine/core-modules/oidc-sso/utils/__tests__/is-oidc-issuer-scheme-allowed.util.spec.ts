import { isOidcIssuerSchemeAllowed } from 'src/engine/core-modules/oidc-sso/utils/is-oidc-issuer-scheme-allowed.util';

describe('isOidcIssuerSchemeAllowed', () => {
  it('allows https everywhere', () => {
    expect(
      isOidcIssuerSchemeAllowed({
        issuer: 'https://idp.example.com',
        isDevelopment: false,
      }),
    ).toBe(true);
  });

  it('rejects http outside development', () => {
    expect(
      isOidcIssuerSchemeAllowed({
        issuer: 'http://idp.example.com',
        isDevelopment: false,
      }),
    ).toBe(false);
  });

  it('allows http in development', () => {
    expect(
      isOidcIssuerSchemeAllowed({
        issuer: 'http://localhost:8085/idp-a',
        isDevelopment: true,
      }),
    ).toBe(true);
  });
});
