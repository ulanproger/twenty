export type OidcProviderStatus = 'active' | 'inactive';

export type OidcProvider = {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  status: OidcProviderStatus;
  isGlobal: boolean;
};

export type PublicOidcProvider = {
  id: string;
  name: string;
  loginUrl: string;
};
