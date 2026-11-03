import { OIDC_SSO_LOGIN_PATH } from 'src/engine/core-modules/oidc-sso/constants/oidc-sso-paths.constant';

export const buildOidcLoginUrl = (
  serverUrl: string,
  providerId: string,
): string => {
  const loginUrl = new URL(serverUrl);

  loginUrl.pathname = `${OIDC_SSO_LOGIN_PATH}/${providerId}`;
  loginUrl.search = '';
  loginUrl.hash = '';

  return loginUrl.toString();
};
