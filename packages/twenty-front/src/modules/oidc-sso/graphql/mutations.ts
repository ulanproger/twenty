import { gql } from '@apollo/client';

export const CREATE_OIDC_PROVIDER = gql`
  mutation CreateOidcProvider($input: CreateOidcProviderInput!) {
    createOidcProvider(input: $input) {
      id
    }
  }
`;

export const UPDATE_OIDC_PROVIDER = gql`
  mutation UpdateOidcProvider($input: UpdateOidcProviderInput!) {
    updateOidcProvider(input: $input) {
      id
      status
    }
  }
`;

export const DELETE_OIDC_PROVIDER = gql`
  mutation DeleteOidcProvider($input: DeleteOidcProviderInput!) {
    deleteOidcProvider(input: $input)
  }
`;
