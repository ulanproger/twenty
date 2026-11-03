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
const isExplicitlyTrue = (value: unknown): boolean =>
  value === true || (isString(value) && value.toLowerCase() === 'true');

export const extractOidcIdentity = (
  claims: Record<string, unknown>,
): ExtractOidcIdentityResult => {
  const email = readTrimmedString(claims.email);

  if (email === null) {
    return { status: 'rejected', reason: 'email-missing' };
  }

  // The sign-in trusts the email as verified, so the IdP has to say so.
  if (!isExplicitlyTrue(claims.email_verified)) {
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
