import { type MockedResponse } from '@apollo/client/testing';
import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { useRedirect } from '@/domain-manager/hooks/useRedirect';
import { SignInUpWithOidc } from '@/oidc-sso/components/SignInUpWithOidc';
import { PUBLIC_OIDC_PROVIDERS } from '@/oidc-sso/graphql/queries';

jest.mock('@/domain-manager/hooks/useRedirect');

const redirect = jest.fn();
(useRedirect as jest.Mock).mockReturnValue({ redirect });

const providersMock = (
  publicOidcProviders: { id: string; name: string; loginUrl: string }[],
): MockedResponse => ({
  request: {
    query: PUBLIC_OIDC_PROVIDERS,
    variables: { origin: window.location.origin },
  },
  result: { data: { publicOidcProviders } },
});

const renderButtons = (mock: MockedResponse, path = '/') =>
  render(
    <Provider store={createStore()}>
      <MockedProvider mocks={[mock]}>
        <I18nProvider i18n={i18n}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/" element={<SignInUpWithOidc />} />
              <Route
                path="/invite/:workspaceInviteHash"
                element={<SignInUpWithOidc />}
              />
            </Routes>
          </MemoryRouter>
        </I18nProvider>
      </MockedProvider>
    </Provider>,
  );

const keycloak = {
  __typename: 'PublicOidcProvider',
  id: 'p1',
  name: 'Keycloak',
  loginUrl: 'https://api.example.com/auth/oidc-sso/login/p1',
};
const okta = { ...keycloak, id: 'p2', name: 'Okta' };

beforeEach(() => jest.clearAllMocks());

it('renders nothing when the workspace has no providers', async () => {
  const { container } = renderButtons(providersMock([]));

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(screen.queryByRole('button')).toBeNull();
  expect(container).toBeEmptyDOMElement();
});

it('renders one button per provider and redirects to its login url', async () => {
  renderButtons(providersMock([keycloak, okta]));

  expect(
    await screen.findByRole('button', { name: /Sign in with Okta/ }),
  ).toBeVisible();

  await userEvent.click(
    screen.getByRole('button', { name: /Sign in with Keycloak/ }),
  );

  expect(redirect).toHaveBeenCalledWith(keycloak.loginUrl);
});

it('forwards the invite hash and keeps the login url host and path', async () => {
  renderButtons(providersMock([keycloak]), '/invite/abc123');

  await userEvent.click(
    await screen.findByRole('button', { name: /Sign in with Keycloak/ }),
  );

  expect(redirect).toHaveBeenCalledWith(
    `${keycloak.loginUrl}?workspaceInviteHash=abc123`,
  );
});
