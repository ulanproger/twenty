import { isNonEmptyString, isString } from '@sniptt/guards';
import { emailSchema } from 'twenty-shared/utils';

export type OidcIdentity = {
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export type ExtractOidcIdentityResult =
  | { status: 'accepted'; identity: OidcIdentity }
  | {
      status: 'rejected';
      reason: 'email-missing' | 'email-invalid' | 'email-not-verified';
    };

const readTrimmedString = (value: unknown): string | null => {
  if (!isString(value)) {
    return null;
  }

  const trimmed = value.trim();

  return isNonEmptyString(trimmed) ? trimmed : null;
};

// Some IdPs (e.g. Cognito) send booleans as strings.
const isExplicitlyFalse = (value: unknown): boolean =>
  value === false || (isString(value) && value.toLowerCase() === 'false');

export const extractOidcIdentity = (
  claims: Record<string, unknown>,
): ExtractOidcIdentityResult => {
  const emailClaim = readTrimmedString(claims.email);
  const email = emailClaim ?? readTrimmedString(claims.upn);

  if (email === null) {
    return { status: 'rejected', reason: 'email-missing' };
  }

  // upn has no verified flag, so only the email claim is subject to it.
  if (emailClaim !== null && isExplicitlyFalse(claims.email_verified)) {
    return { status: 'rejected', reason: 'email-not-verified' };
  }

  if (!emailSchema.safeParse(email).success) {
    return { status: 'rejected', reason: 'email-invalid' };
  }

  return {
    status: 'accepted',
    identity: {
      email,
      firstName: readTrimmedString(claims.given_name),
      lastName: readTrimmedString(claims.family_name),
    },
  };
};
