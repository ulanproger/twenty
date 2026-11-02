// Returns null for anything that is not a plain http(s) issuer URL.
export const normalizeOidcIssuer = (rawIssuer: string): string | null => {
  const trimmedIssuer = rawIssuer.trim();

  // URL parsing drops an empty "?" or "#", so they are rejected on the raw string.
  if (/[?#]/.test(trimmedIssuer)) {
    return null;
  }

  let issuerUrl: URL;

  try {
    issuerUrl = new URL(trimmedIssuer);
  } catch {
    return null;
  }

  const isHttp =
    issuerUrl.protocol === 'http:' || issuerUrl.protocol === 'https:';
  const hasCredentials = issuerUrl.username !== '' || issuerUrl.password !== '';

  if (!isHttp || hasCredentials) {
    return null;
  }

  return issuerUrl.toString().replace(/\/+$/, '');
};
