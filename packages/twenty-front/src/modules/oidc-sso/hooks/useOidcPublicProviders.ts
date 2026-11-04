import { useQuery } from '@apollo/client/react';

import { useOrigin } from '@/domain-manager/hooks/useOrigin';
import { PUBLIC_OIDC_PROVIDERS } from '@/oidc-sso/graphql/queries';
import { type PublicOidcProvider } from '@/oidc-sso/types/OidcProvider';

type PublicOidcProvidersData = { publicOidcProviders: PublicOidcProvider[] };

export const useOidcPublicProviders = (): PublicOidcProvider[] => {
  const { origin } = useOrigin();

  const { data } = useQuery<PublicOidcProvidersData>(PUBLIC_OIDC_PROVIDERS, {
    variables: { origin },
  });

  return data?.publicOidcProviders ?? [];
};
