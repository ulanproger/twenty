export type OidcProviderStatus = 'active' | 'inactive';

export type OidcProvider = {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  status: OidcProviderStatus;
};

export type PublicOidcProvider = {
  id: string;
  name: string;
  loginUrl: string;
};
