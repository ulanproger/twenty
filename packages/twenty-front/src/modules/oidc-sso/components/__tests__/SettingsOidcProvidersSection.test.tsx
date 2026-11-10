import { type MockedResponse } from '@apollo/client/testing';
import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';

import { SettingsOidcProvidersSection } from '@/oidc-sso/components/SettingsOidcProvidersSection';
import {
  CREATE_OIDC_PROVIDER,
  DELETE_OIDC_PROVIDER,
  UPDATE_OIDC_PROVIDER,
} from '@/oidc-sso/graphql/mutations';
import { OIDC_PROVIDERS } from '@/oidc-sso/graphql/queries';

jest.mock('twenty-ui/components/feedback', () => ({
  ...jest.requireActual('twenty-ui/components/feedback'),
  useToast: () => ({ enqueueToast: jest.fn() }),
}));

const provider = {
  __typename: 'OidcProvider',
  id: 'p1',
  name: 'Keycloak',
  issuer: 'https://idp.example.com',
  clientId: 'twenty',
  status: 'active',
  isGlobal: false,
};

const listMock = (oidcProviders: unknown[]): MockedResponse => ({
  request: { query: OIDC_PROVIDERS },
  result: { data: { oidcProviders } },
  maxUsageCount: 5,
});

const renderSection = (mocks: MockedResponse[]) =>
  render(
    <Provider store={createStore()}>
      <MockedProvider mocks={mocks}>
        <I18nProvider i18n={i18n}>
          <SettingsOidcProvidersSection />
        </I18nProvider>
      </MockedProvider>
    </Provider>,
  );

it('lists providers without any secret field', async () => {
  renderSection([listMock([provider])]);

  expect(await screen.findByText('Keycloak')).toBeVisible();
  expect(screen.getByText('https://idp.example.com')).toBeVisible();
  expect(screen.queryByText(/secret/i)).toBeNull();
});

it('keeps Add disabled until every field is filled, then creates the provider', async () => {
  const created = jest.fn(() => ({
    data: { createOidcProvider: { __typename: 'OidcProvider', id: 'p2' } },
  }));
  renderSection([
    listMock([]),
    {
      request: {
        query: CREATE_OIDC_PROVIDER,
        variables: {
          input: {
            name: 'Okta',
            issuer: 'https://okta.example.com',
            clientId: 'abc',
            clientSecret: 's3cret',
          },
        },
      },
      result: created,
    },
  ]);

  await userEvent.click(
    await screen.findByRole('button', { name: /Add OIDC provider/ }),
  );

  const add = await screen.findByRole('button', { name: 'Add' });
  expect(add).toBeDisabled();

  await userEvent.type(screen.getByLabelText('Name'), ' Okta ');
  await userEvent.type(
    screen.getByLabelText('Issuer URL'),
    'https://okta.example.com',
  );
  await userEvent.type(screen.getByLabelText('Client ID'), 'abc');
  expect(add).toBeDisabled();

  await userEvent.type(screen.getByLabelText('Client secret'), 's3cret ');
  expect(add).toBeEnabled();

  await userEvent.click(add);

  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
});

it('deactivates a provider from the row menu', async () => {
  const updated = jest.fn(() => ({
    data: {
      updateOidcProvider: {
        __typename: 'OidcProvider',
        id: 'p1',
        status: 'inactive',
      },
    },
  }));
  renderSection([
    listMock([provider]),
    {
      request: {
        query: UPDATE_OIDC_PROVIDER,
        variables: { input: { id: 'p1', status: 'inactive' } },
      },
      result: updated,
    },
  ]);

  await userEvent.click(await screen.findByLabelText('More options'));
  await userEvent.click(await screen.findByText('Deactivate'));

  await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
});

it('deletes a provider only after the confirmation', async () => {
  const deleted = jest.fn(() => ({ data: { deleteOidcProvider: true } }));
  renderSection([
    listMock([provider]),
    {
      request: {
        query: DELETE_OIDC_PROVIDER,
        variables: { input: { id: 'p1' } },
      },
      result: deleted,
    },
  ]);

  await userEvent.click(await screen.findByLabelText('More options'));
  await userEvent.click(await screen.findByText('Delete'));

  expect(deleted).not.toHaveBeenCalled();

  const confirm = await screen.findAllByRole('button', { name: 'Delete' });
  await userEvent.click(confirm[confirm.length - 1]);

  await waitFor(() => expect(deleted).toHaveBeenCalledTimes(1));
});

it('shows a platform-wide provider read-only', async () => {
  renderSection([listMock([{ ...provider, name: 'Rauthy', isGlobal: true }])]);

  expect(await screen.findByText('Rauthy')).toBeVisible();
  expect(screen.getByText('Active')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /Add OIDC provider/ }),
  ).toBeNull();
  expect(screen.queryByLabelText('More options')).toBeNull();
});
