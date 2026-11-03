// The client secret travels to the token endpoint, so plain http is for development only.
export const isOidcIssuerSchemeAllowed = ({
  issuer,
  isDevelopment,
}: {
  issuer: string;
  isDevelopment: boolean;
}): boolean => isDevelopment || issuer.startsWith('https://');
