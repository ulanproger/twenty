import { normalizeOidcIssuer } from 'src/engine/core-modules/oidc-sso/utils/normalize-oidc-issuer.util';

describe('normalizeOidcIssuer', () => {
  it.each([
    ['https://idp.example.com', 'https://idp.example.com'],
    ['https://idp.example.com/', 'https://idp.example.com'],
    ['https://idp.example.com///', 'https://idp.example.com'],
    [
      '  https://idp.example.com/realms/main/ ',
      'https://idp.example.com/realms/main',
    ],
    [
      'https://login.example.com/tenant/v2.0',
      'https://login.example.com/tenant/v2.0',
    ],
    ['http://localhost:8085/idp-a', 'http://localhost:8085/idp-a'],
    ['HTTPS://IDP.EXAMPLE.COM/a', 'https://idp.example.com/a'],
  ])('normalizes %s', (rawIssuer, expected) => {
    expect(normalizeOidcIssuer(rawIssuer)).toBe(expected);
  });

  it.each([
    [''],
    ['idp.example.com'],
    ['ftp://idp.example.com'],
    ['javascript:alert(1)'],
    ['https://user:pass@idp.example.com'],
    ['https://idp.example.com?x=1'],
    ['https://idp.example.com#frag'],
    ['https://idp.example.com/?'],
    ['https://idp.example.com/#'],
  ])('rejects %j', (rawIssuer) => {
    expect(normalizeOidcIssuer(rawIssuer)).toBeNull();
  });
});
