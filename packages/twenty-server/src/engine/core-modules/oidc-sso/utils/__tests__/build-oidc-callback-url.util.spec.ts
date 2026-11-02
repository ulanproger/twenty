import { buildOidcCallbackUrl } from 'src/engine/core-modules/oidc-sso/utils/build-oidc-callback-url.util';

describe('buildOidcCallbackUrl', () => {
  it.each([
    ['http://localhost:3000', 'http://localhost:3000/auth/oidc-sso/callback'],
    [
      'https://crm.example.com/',
      'https://crm.example.com/auth/oidc-sso/callback',
    ],
    [
      'https://crm.example.com/some/path',
      'https://crm.example.com/auth/oidc-sso/callback',
    ],
    [
      'https://crm.example.com/?x=1#frag',
      'https://crm.example.com/auth/oidc-sso/callback',
    ],
  ])('builds callback for %s', (serverUrl, expected) => {
    expect(buildOidcCallbackUrl(serverUrl)).toBe(expected);
  });
});
