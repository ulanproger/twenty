import { extractOidcIdentity } from 'src/engine/core-modules/oidc-sso/utils/extract-oidc-identity.util';

const VERIFIED = { email_verified: true };

describe('extractOidcIdentity', () => {
  it.each([
    ['email_verified true', { email: 'a@example.com', email_verified: true }],
    [
      'email_verified as string "true"',
      { email: 'a@example.com', email_verified: 'true' },
    ],
    [
      'email_verified as string "True"',
      { email: 'a@example.com', email_verified: 'True' },
    ],
    ['surrounding whitespace', { email: '  a@example.com ', ...VERIFIED }],
  ])('accepts %s', (_label, claims) => {
    expect(extractOidcIdentity(claims)).toEqual({
      status: 'accepted',
      identity: { email: 'a@example.com', firstName: null, lastName: null },
    });
  });

  it.each([
    ['no email_verified claim', { email: 'a@example.com' }],
    ['email_verified false', { email: 'a@example.com', email_verified: false }],
    [
      'email_verified "false"',
      { email: 'a@example.com', email_verified: 'false' },
    ],
    ['email_verified "yes"', { email: 'a@example.com', email_verified: 'yes' }],
    ['email_verified 1', { email: 'a@example.com', email_verified: 1 }],
  ])('rejects %s as not verified', (_label, claims) => {
    expect(extractOidcIdentity(claims)).toEqual({
      status: 'rejected',
      reason: 'email-not-verified',
    });
  });

  it.each([
    ['no claims', {}],
    [
      'empty email that is also unverified',
      { email: '', email_verified: false },
    ],
    ['empty email', { email: '', ...VERIFIED }],
    ['blank email', { email: '   ', ...VERIFIED }],
    ['non-string email', { email: 42, ...VERIFIED }],
    ['only upn', { upn: 'a@example.com', ...VERIFIED }],
  ])('rejects %s as missing email', (_label, claims) => {
    expect(extractOidcIdentity(claims)).toEqual({
      status: 'rejected',
      reason: 'email-missing',
    });
  });

  it.each([['not-an-email'], ['DOMAIN\\user'], ['a b@example.com']])(
    'rejects malformed email %s',
    (email) => {
      expect(extractOidcIdentity({ email, ...VERIFIED })).toEqual({
        status: 'rejected',
        reason: 'email-invalid',
      });
    },
  );

  it('reads names and treats non-string or empty names as null', () => {
    expect(
      extractOidcIdentity({
        email: 'a@example.com',
        ...VERIFIED,
        given_name: ' Ada ',
        family_name: 'Lovelace',
      }),
    ).toEqual({
      status: 'accepted',
      identity: {
        email: 'a@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    });

    expect(
      extractOidcIdentity({
        email: 'a@example.com',
        ...VERIFIED,
        given_name: '',
        family_name: 7,
      }),
    ).toEqual({
      status: 'accepted',
      identity: { email: 'a@example.com', firstName: null, lastName: null },
    });
  });
});
