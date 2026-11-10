import { isString } from '@sniptt/guards';
import { isPlainObject } from 'twenty-shared/utils';

export type OidcLogin = {
  state: string;
  nonce: string;
  codeVerifier: string;
  providerId: string;
  // Matters only for the global provider, which has no workspace of its own;
  // stored providers carry theirs, and the lookup ignores this value for them.
  workspaceId: string | null;
  workspaceInviteHash: string | null;
  createdAt: number;
};

export type TakeOidcLoginResult =
  | { status: 'found'; login: OidcLogin; remainingLogins: OidcLogin[] }
  | { status: 'missing' | 'expired'; remainingLogins: OidcLogin[] };

const isOidcLogin = (value: unknown): value is OidcLogin =>
  isPlainObject(value) &&
  isString(value.state) &&
  isString(value.nonce) &&
  isString(value.codeVerifier) &&
  isString(value.providerId) &&
  (value.workspaceId === undefined ||
    value.workspaceId === null ||
    isString(value.workspaceId)) &&
  (value.workspaceInviteHash === null || isString(value.workspaceInviteHash)) &&
  typeof value.createdAt === 'number';

// Session data comes back from Redis as unknown, so it is re-validated on every read.
// A login stored before workspaceId existed has no such key, it reads as null.
const parseOidcLogins = (logins: unknown): OidcLogin[] =>
  Array.isArray(logins)
    ? logins
        .filter(isOidcLogin)
        .map((login) => ({ ...login, workspaceId: login.workspaceId ?? null }))
    : [];

export const addOidcLogin = ({
  logins,
  login,
  maxLogins,
}: {
  logins: unknown;
  login: OidcLogin;
  maxLogins: number;
}): OidcLogin[] => [...parseOidcLogins(logins), login].slice(-maxLogins);

// The returned remainingLogins no longer contain the taken login, so it is single-use.
export const takeOidcLogin = ({
  logins,
  state,
  now,
  maxAgeMs,
}: {
  logins: unknown;
  state: string;
  now: number;
  maxAgeMs: number;
}): TakeOidcLoginResult => {
  const allLogins = parseOidcLogins(logins);
  const login = allLogins.find((candidate) => candidate.state === state);

  if (login === undefined) {
    return { status: 'missing', remainingLogins: allLogins };
  }

  const remainingLogins = allLogins.filter((candidate) => candidate !== login);

  if (now - login.createdAt > maxAgeMs) {
    return { status: 'expired', remainingLogins };
  }

  return { status: 'found', login, remainingLogins };
};
