import { pickOidcIdTokenSigningAlgorithm } from 'src/engine/core-modules/oidc-sso/utils/pick-oidc-id-token-signing-algorithm.util';

describe('pickOidcIdTokenSigningAlgorithm', () => {
  it.each([
    ['no list', {}],
    [
      'RS256 listed',
      { id_token_signing_alg_values_supported: ['ES256', 'RS256'] },
    ],
    [
      'list is not an array',
      { id_token_signing_alg_values_supported: 'RS256' },
    ],
    [
      'only symmetric and none',
      { id_token_signing_alg_values_supported: ['HS256', 'none'] },
    ],
  ])('keeps the default for %s', (_label, metadata) => {
    expect(pickOidcIdTokenSigningAlgorithm(metadata)).toBeUndefined();
  });

  it.each([
    [['ES256'], 'ES256'],
    [['none', 'HS256', 'PS256', 'ES256'], 'PS256'],
    [['EdDSA'], 'EdDSA'],
    [['RS384'], 'RS384'],
  ])('picks from %j', (supported, expected) => {
    expect(
      pickOidcIdTokenSigningAlgorithm({
        id_token_signing_alg_values_supported: supported,
      }),
    ).toBe(expected);
  });
});
