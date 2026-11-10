import { isDefined } from 'twenty-shared/utils';

import { OIDC_SSO_LOGIN_PATH } from 'src/engine/core-modules/oidc-sso/constants/oidc-sso-paths.constant';

// workspaceId is only for the global provider, which cannot know the workspace by itself.
export const buildOidcLoginUrl = (
  serverUrl: string,
  providerId: string,
  workspaceId?: string,
): string => {
  const loginUrl = new URL(serverUrl);

  loginUrl.pathname = `${OIDC_SSO_LOGIN_PATH}/${providerId}`;
  loginUrl.search = '';
  loginUrl.hash = '';

  if (isDefined(workspaceId)) {
    loginUrl.searchParams.set('workspaceId', workspaceId);
  }

  return loginUrl.toString();
};
