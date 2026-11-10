import { gql } from '@apollo/client';

export const OIDC_PROVIDERS = gql`
  query OidcProviders {
    oidcProviders {
      id
      name
      issuer
      clientId
      status
      isGlobal
    }
  }
`;

export const PUBLIC_OIDC_PROVIDERS = gql`
  query PublicOidcProviders($origin: String!) {
    publicOidcProviders(origin: $origin) {
      id
      name
      loginUrl
    }
  }
`;
