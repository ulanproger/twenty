import { buildOidcLoginUrl } from 'src/engine/core-modules/oidc-sso/utils/build-oidc-login-url.util';

describe('buildOidcLoginUrl', () => {
  it('appends the login path and provider id to the server origin', () => {
    expect(buildOidcLoginUrl('https://crm.example.com', 'provider-1')).toBe(
      'https://crm.example.com/auth/oidc-sso/login/provider-1',
    );
  });

  it('drops any path, query and hash of the server url', () => {
    expect(
      buildOidcLoginUrl('http://localhost:3000/base?x=1#y', 'provider-1'),
    ).toBe('http://localhost:3000/auth/oidc-sso/login/provider-1');
  });
});
