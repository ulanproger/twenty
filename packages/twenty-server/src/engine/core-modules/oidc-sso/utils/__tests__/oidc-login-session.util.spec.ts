import {
  addOidcLogin,
  takeOidcLogin,
  type OidcLogin,
} from 'src/engine/core-modules/oidc-sso/utils/oidc-login-session.util';

const buildLogin = (overrides: Partial<OidcLogin> = {}): OidcLogin => ({
  state: 'state-1',
  nonce: 'nonce-1',
  codeVerifier: 'verifier-1',
  providerId: 'provider-1',
  workspaceId: null,
  workspaceInviteHash: null,
  createdAt: 1_000,
  ...overrides,
});

describe('addOidcLogin', () => {
  it('appends to existing logins', () => {
    const first = buildLogin({ state: 'a' });
    const second = buildLogin({ state: 'b' });

    expect(
      addOidcLogin({ logins: [first], login: second, maxLogins: 5 }),
    ).toEqual([first, second]);
  });

  it('keeps only the newest logins', () => {
    const logins = ['a', 'b', 'c'].map((state) => buildLogin({ state }));

    expect(
      addOidcLogin({
        logins,
        login: buildLogin({ state: 'd' }),
        maxLogins: 2,
      }).map((login) => login.state),
    ).toEqual(['c', 'd']);
  });

  it.each([[undefined], [null], ['garbage'], [{}], [[1, 'x', { state: 1 }]]])(
    'starts fresh from unusable session data %j',
    (logins) => {
      const login = buildLogin();

      expect(addOidcLogin({ logins, login, maxLogins: 5 })).toEqual([login]);
    },
  );
});

describe('takeOidcLogin', () => {
  const now = 2_000;
  const maxAgeMs = 5_000;

  it('finds a fresh login and removes it from the remaining ones', () => {
    const wanted = buildLogin({ state: 'wanted' });
    const other = buildLogin({ state: 'other' });

    expect(
      takeOidcLogin({
        logins: [other, wanted],
        state: 'wanted',
        now,
        maxAgeMs,
      }),
    ).toEqual({ status: 'found', login: wanted, remainingLogins: [other] });
  });

  it('cannot take the same login twice', () => {
    const first = takeOidcLogin({
      logins: [buildLogin()],
      state: 'state-1',
      now,
      maxAgeMs,
    });

    expect(
      takeOidcLogin({
        logins: first.remainingLogins,
        state: 'state-1',
        now,
        maxAgeMs,
      }).status,
    ).toBe('missing');
  });

  it('reports an unknown state without touching the other logins', () => {
    const existing = buildLogin();

    expect(
      takeOidcLogin({ logins: [existing], state: 'foreign', now, maxAgeMs }),
    ).toEqual({ status: 'missing', remainingLogins: [existing] });
  });

  it('reports an expired login and drops it', () => {
    expect(
      takeOidcLogin({
        logins: [buildLogin({ createdAt: 1_000 })],
        state: 'state-1',
        now: 1_000 + maxAgeMs + 1,
        maxAgeMs,
      }),
    ).toEqual({ status: 'expired', remainingLogins: [] });
  });

  it('accepts a login exactly at the age limit', () => {
    expect(
      takeOidcLogin({
        logins: [buildLogin({ createdAt: 1_000 })],
        state: 'state-1',
        now: 1_000 + maxAgeMs,
        maxAgeMs,
      }).status,
    ).toBe('found');
  });

  it.each([[undefined], ['garbage'], [[{ state: 'state-1' }]]])(
    'treats unusable session data %j as missing',
    (logins) => {
      expect(
        takeOidcLogin({ logins, state: 'state-1', now, maxAgeMs }),
      ).toEqual({ status: 'missing', remainingLogins: [] });
    },
  );
});

describe('oidc login without a stored workspaceId', () => {
  it('reads a login saved before workspaceId existed as null', () => {
    const { workspaceId: _workspaceId, ...legacyLogin } = buildLogin();

    const result = takeOidcLogin({
      logins: [legacyLogin],
      state: 'state-1',
      now: 2_000,
      maxAgeMs: 10_000,
    });

    expect(result).toMatchObject({
      status: 'found',
      login: { workspaceId: null },
    });
  });

  it('keeps a stored workspaceId', () => {
    const result = takeOidcLogin({
      logins: [buildLogin({ workspaceId: 'workspace-a' })],
      state: 'state-1',
      now: 2_000,
      maxAgeMs: 10_000,
    });

    expect(result).toMatchObject({
      status: 'found',
      login: { workspaceId: 'workspace-a' },
    });
  });
});
