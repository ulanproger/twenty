import { isNonEmptyString } from '@sniptt/guards';

import { OIDC_GLOBAL_PROVIDER_ID } from 'src/engine/core-modules/oidc-sso/constants/oidc-global-provider-id.constant';
import { isOidcIssuerSchemeAllowed } from 'src/engine/core-modules/oidc-sso/utils/is-oidc-issuer-scheme-allowed.util';
import { normalizeOidcIssuer } from 'src/engine/core-modules/oidc-sso/utils/normalize-oidc-issuer.util';

const DEFAULT_OIDC_GLOBAL_PROVIDER_NAME = 'OIDC';

export type OidcGlobalProvider = {
  id: typeof OIDC_GLOBAL_PROVIDER_ID;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
};

export type ReadOidcGlobalProviderResult =
  | { status: 'off' }
  | { status: 'incomplete' }
  | { status: 'invalid-issuer' }
  | { status: 'on'; provider: OidcGlobalProvider };

// 'off' only when none of the three is set. A partial setup or a bad issuer is reported
// as broken, so a typo cannot hand sign-in back to stored providers.
export const readOidcGlobalProvider = ({
  issuer,
  clientId,
  clientSecret,
  name,
  isDevelopment,
}: {
  issuer: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  name: string | undefined;
  isDevelopment: boolean;
}): ReadOidcGlobalProviderResult => {
  const trimmedIssuer = issuer?.trim();
  const trimmedClientId = clientId?.trim();
  const trimmedClientSecret = clientSecret?.trim();
  const trimmedName = name?.trim();

  if (
    ![trimmedIssuer, trimmedClientId, trimmedClientSecret].some(
      isNonEmptyString,
    )
  ) {
    return { status: 'off' };
  }

  if (
    !isNonEmptyString(trimmedIssuer) ||
    !isNonEmptyString(trimmedClientId) ||
    !isNonEmptyString(trimmedClientSecret)
  ) {
    return { status: 'incomplete' };
  }

  const normalizedIssuer = normalizeOidcIssuer(trimmedIssuer);

  if (
    normalizedIssuer === null ||
    !isOidcIssuerSchemeAllowed({ issuer: normalizedIssuer, isDevelopment })
  ) {
    return { status: 'invalid-issuer' };
  }

  return {
    status: 'on',
    provider: {
      id: OIDC_GLOBAL_PROVIDER_ID,
      name: isNonEmptyString(trimmedName)
        ? trimmedName
        : DEFAULT_OIDC_GLOBAL_PROVIDER_NAME,
      issuer: normalizedIssuer,
      clientId: trimmedClientId,
      clientSecret: trimmedClientSecret,
    },
  };
};
