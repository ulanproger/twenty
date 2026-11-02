// Returns null for anything that is not a plain http(s) issuer URL.
export const normalizeOidcIssuer = (rawIssuer: string): string | null => {
  let issuerUrl: URL;

  try {
    issuerUrl = new URL(rawIssuer.trim());
  } catch {
    return null;
  }

  const isHttp =
    issuerUrl.protocol === 'http:' || issuerUrl.protocol === 'https:';
  const hasCredentials = issuerUrl.username !== '' || issuerUrl.password !== '';

  if (
    !isHttp ||
    hasCredentials ||
    issuerUrl.search !== '' ||
    issuerUrl.hash !== ''
  ) {
    return null;
  }

  return issuerUrl.toString().replace(/\/+$/, '');
};
