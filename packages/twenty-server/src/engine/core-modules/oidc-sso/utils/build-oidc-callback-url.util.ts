import { OIDC_SSO_CALLBACK_PATH } from 'src/engine/core-modules/oidc-sso/constants/oidc-sso-paths.constant';

export const buildOidcCallbackUrl = (serverUrl: string): string => {
  const callbackUrl = new URL(serverUrl);

  callbackUrl.pathname = OIDC_SSO_CALLBACK_PATH;
  callbackUrl.search = '';
  callbackUrl.hash = '';

  return callbackUrl.toString();
};
