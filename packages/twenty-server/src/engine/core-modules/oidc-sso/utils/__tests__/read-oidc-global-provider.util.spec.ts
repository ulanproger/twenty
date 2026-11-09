import { OIDC_GLOBAL_PROVIDER_ID } from 'src/engine/core-modules/oidc-sso/constants/oidc-global-provider-id.constant';
import { readOidcGlobalProvider } from 'src/engine/core-modules/oidc-sso/utils/read-oidc-global-provider.util';

const complete = {
  issuer: 'https://idp.example.com/auth/v1/',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  name: 'Rauthy',
  isDevelopment: false,
};

describe('readOidcGlobalProvider', () => {
  it('returns the provider with a normalized issuer when everything is set', () => {
    expect(readOidcGlobalProvider(complete)).toEqual({
      status: 'on',
      provider: {
        id: OIDC_GLOBAL_PROVIDER_ID,
        name: 'Rauthy',
        issuer: 'https://idp.example.com/auth/v1',
        clientId: 'client-1',
        clientSecret: 'secret-1',
      },
    });
  });

  it.each(['issuer', 'clientId', 'clientSecret'] as const)(
    'is off when %s is missing or blank',
    (field) => {
      expect(
        readOidcGlobalProvider({ ...complete, [field]: undefined }),
      ).toEqual({ status: 'off' });
      expect(readOidcGlobalProvider({ ...complete, [field]: '  ' })).toEqual({
        status: 'off',
      });
    },
  );

  it('falls back to a default name', () => {
    const result = readOidcGlobalProvider({ ...complete, name: undefined });

    expect(result).toMatchObject({
      status: 'on',
      provider: { name: 'OIDC' },
    });
  });

  it('rejects an issuer that is not a plain URL', () => {
    expect(
      readOidcGlobalProvider({ ...complete, issuer: 'not a url' }),
    ).toEqual({ status: 'invalid-issuer' });
  });

  it('rejects http outside development and allows it in development', () => {
    const issuer = 'http://localhost:8085/idp-a';

    expect(readOidcGlobalProvider({ ...complete, issuer })).toEqual({
      status: 'invalid-issuer',
    });
    expect(
      readOidcGlobalProvider({ ...complete, issuer, isDevelopment: true }),
    ).toMatchObject({ status: 'on' });
  });
});
