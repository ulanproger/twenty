import { isNonEmptyString, isString } from '@sniptt/guards';

import { normalizeOidcIssuer } from 'src/engine/core-modules/oidc-sso/utils/normalize-oidc-issuer.util';

export type OidcDiscoveryValidationResult =
  | { status: 'valid' }
  | {
      status: 'invalid';
      reason: 'issuer-mismatch' | 'endpoint-missing' | 'pkce-s256-unsupported';
    };

const REQUIRED_ENDPOINTS = [
  'authorization_endpoint',
  'token_endpoint',
  'jwks_uri',
] as const;

// OIDC Discovery 4.3: the document must name the same issuer it was fetched for.
// Compared after normalization because some IdPs (Auth0) publish a trailing slash.
export const validateOidcDiscoveryMetadata = ({
  expectedIssuer,
  metadata,
}: {
  expectedIssuer: string;
  metadata: Record<string, unknown>;
}): OidcDiscoveryValidationResult => {
  const discoveredIssuer = isString(metadata.issuer)
    ? normalizeOidcIssuer(metadata.issuer)
    : null;

  if (
    discoveredIssuer === null ||
    discoveredIssuer !== normalizeOidcIssuer(expectedIssuer)
  ) {
    return { status: 'invalid', reason: 'issuer-mismatch' };
  }

  if (REQUIRED_ENDPOINTS.some((key) => !isNonEmptyString(metadata[key]))) {
    return { status: 'invalid', reason: 'endpoint-missing' };
  }

  const challengeMethods = metadata.code_challenge_methods_supported;

  if (Array.isArray(challengeMethods) && !challengeMethods.includes('S256')) {
    return { status: 'invalid', reason: 'pkce-s256-unsupported' };
  }

  return { status: 'valid' };
};
