import { isString } from '@sniptt/guards';

const ASYMMETRIC_ALGORITHM_PATTERN = /^(RS|PS|ES)\d{3}$|^EdDSA$/;

// undefined keeps the openid-client default (RS256); "none" and HS* are never picked.
export const pickOidcIdTokenSigningAlgorithm = (
  metadata: Record<string, unknown>,
): string | undefined => {
  const supportedAlgorithms = metadata.id_token_signing_alg_values_supported;

  if (
    !Array.isArray(supportedAlgorithms) ||
    supportedAlgorithms.includes('RS256')
  ) {
    return undefined;
  }

  return supportedAlgorithms.find(
    (algorithm): algorithm is string =>
      isString(algorithm) && ASYMMETRIC_ALGORITHM_PATTERN.test(algorithm),
  );
};
