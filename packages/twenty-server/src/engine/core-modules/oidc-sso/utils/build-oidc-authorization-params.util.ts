export const buildOidcAuthorizationParams = ({
  callbackUrl,
  state,
  nonce,
  codeChallenge,
}: {
  callbackUrl: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}) => ({
  response_type: 'code',
  response_mode: 'query',
  scope: 'openid email profile',
  redirect_uri: callbackUrl,
  state,
  nonce,
  code_challenge: codeChallenge,
  code_challenge_method: 'S256',
});
