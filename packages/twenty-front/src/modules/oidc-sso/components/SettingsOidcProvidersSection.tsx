import { useQuery } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { Section } from 'twenty-ui/components/layout';
import { IconLock } from 'twenty-ui/icon';

import { ToastOnQueryErrorEffect } from '@/apollo/components/ToastOnQueryErrorEffect';
import { SettingsOidcProviderCreateDialog } from '@/oidc-sso/components/SettingsOidcProviderCreateDialog';
import { SettingsOidcProviderRowMenu } from '@/oidc-sso/components/SettingsOidcProviderRowMenu';
import { OIDC_PROVIDERS } from '@/oidc-sso/graphql/queries';
import { type OidcProvider } from '@/oidc-sso/types/OidcProvider';
import { SettingsListCard } from '@/settings/components/SettingsListCard';
import { useDialog } from '@/ui/layout/dialog/hooks/useDialog';

const CREATE_DIALOG_ID = 'oidc-provider-create';

type OidcProvidersData = { oidcProviders: OidcProvider[] };

export const SettingsOidcProvidersSection = () => {
  const { t } = useLingui();
  const { openDialog } = useDialog();
  const { data, loading, error } = useQuery<OidcProvidersData>(OIDC_PROVIDERS, {
    fetchPolicy: 'network-only',
  });

  const hasGlobalProvider =
    data?.oidcProviders.some((provider) => provider.isGlobal) ?? false;

  return (
    <Section.Root>
      <ToastOnQueryErrorEffect error={error} />
      <Section.Header
        title={t`OIDC`}
        description={
          hasGlobalProvider
            ? t`Set up for the whole platform by the server administrator`
            : t`Let users sign in with your OpenID Connect provider`
        }
      />
      <SettingsListCard
        items={data?.oidcProviders ?? []}
        isLoading={loading}
        getItemLabel={(provider) => provider.name}
        getItemDescription={(provider) => provider.issuer}
        RowIcon={IconLock}
        RowRightComponent={SettingsOidcProviderRowMenu}
        hasFooter={!hasGlobalProvider}
        footerButtonLabel={t`Add OIDC provider`}
        onFooterButtonClick={() => openDialog(CREATE_DIALOG_ID)}
      />
      <SettingsOidcProviderCreateDialog dialogId={CREATE_DIALOG_ID} />
    </Section.Root>
  );
};
