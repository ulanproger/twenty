import { extractOidcIdentity } from 'src/engine/core-modules/oidc-sso/utils/extract-oidc-identity.util';

describe('extractOidcIdentity', () => {
  it.each([
    [
      'email with email_verified true',
      { email: 'a@example.com', email_verified: true },
    ],
    ['email without email_verified', { email: 'a@example.com' }],
    [
      'email_verified as string "true"',
      { email: 'a@example.com', email_verified: 'true' },
    ],
    ['only upn', { upn: 'a@example.com' }],
    [
      'upn ignores email_verified false',
      { upn: 'a@example.com', email_verified: false },
    ],
    ['surrounding whitespace', { email: '  a@example.com ' }],
  ])('accepts %s', (_label, claims) => {
    expect(extractOidcIdentity(claims)).toEqual({
      status: 'accepted',
      identity: { email: 'a@example.com', firstName: null, lastName: null },
    });
  });

  it.each([
    ['email_verified false', { email: 'a@example.com', email_verified: false }],
    [
      'email_verified "False"',
      { email: 'a@example.com', email_verified: 'False' },
    ],
    [
      'email_verified "false"',
      { email: 'a@example.com', email_verified: 'false' },
    ],
    [
      'unverified email even when upn is present',
      { email: 'a@example.com', email_verified: false, upn: 'b@example.com' },
    ],
  ])('rejects %s as not verified', (_label, claims) => {
    expect(extractOidcIdentity(claims)).toEqual({
      status: 'rejected',
      reason: 'email-not-verified',
    });
  });

  it.each([
    ['no claims', {}],
    ['empty email', { email: '' }],
    ['blank email', { email: '   ' }],
    ['non-string email', { email: 42 }],
    ['non-string upn', { upn: ['a@example.com'] }],
  ])('rejects %s as missing email', (_label, claims) => {
    expect(extractOidcIdentity(claims)).toEqual({
      status: 'rejected',
      reason: 'email-missing',
    });
  });

  it.each([['not-an-email'], ['DOMAIN\\user'], ['a b@example.com']])(
    'rejects malformed email %s',
    (email) => {
      expect(extractOidcIdentity({ email })).toEqual({
        status: 'rejected',
        reason: 'email-invalid',
      });
    },
  );

  it('falls back to upn when email is blank', () => {
    expect(extractOidcIdentity({ email: ' ', upn: 'a@corp.example' })).toEqual({
      status: 'accepted',
      identity: { email: 'a@corp.example', firstName: null, lastName: null },
    });
  });

  it('reads names and treats non-string or empty names as null', () => {
    expect(
      extractOidcIdentity({
        email: 'a@example.com',
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
        given_name: '',
        family_name: 7,
      }),
    ).toEqual({
      status: 'accepted',
      identity: { email: 'a@example.com', firstName: null, lastName: null },
    });
  });
});
