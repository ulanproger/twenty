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
  | { status: 'invalid-issuer' }
  | { status: 'on'; provider: OidcGlobalProvider };

// Issuer, client id and secret must all be set; a bad issuer counts as off so a typo cannot half-enable it.
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
  if (
    !isNonEmptyString(issuer?.trim()) ||
    !isNonEmptyString(clientId?.trim()) ||
    !isNonEmptyString(clientSecret?.trim())
  ) {
    return { status: 'off' };
  }

  const normalizedIssuer = normalizeOidcIssuer(issuer);

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
      name: isNonEmptyString(name?.trim())
        ? name.trim()
        : DEFAULT_OIDC_GLOBAL_PROVIDER_NAME,
      issuer: normalizedIssuer,
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
    },
  };
};
