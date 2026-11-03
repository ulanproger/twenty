import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from 'src/engine/core-modules/auth/auth.module';
import { WorkspaceDomainsModule } from 'src/engine/core-modules/domain/workspace-domains/workspace-domains.module';
import { GuardRedirectModule } from 'src/engine/core-modules/guard-redirect/guard-redirect.module';
import { OidcSsoAuthController } from 'src/engine/core-modules/oidc-sso/controllers/oidc-sso-auth.controller';
import { WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import { CreateWorkspaceOidcProviderFastInstanceCommand } from 'src/engine/core-modules/oidc-sso/migrations/1793640971352-create-workspace-oidc-provider.fast-instance-command';
import { OidcProviderResolver } from 'src/engine/core-modules/oidc-sso/resolvers/oidc-provider.resolver';
import { PublicOidcProviderResolver } from 'src/engine/core-modules/oidc-sso/resolvers/public-oidc-provider.resolver';
import { OidcAccountService } from 'src/engine/core-modules/oidc-sso/services/oidc-account.service';
import { OidcProtocolService } from 'src/engine/core-modules/oidc-sso/services/oidc-protocol.service';
import { OidcProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-provider.service';
import { SecretEncryptionModule } from 'src/engine/core-modules/secret-encryption/secret-encryption.module';
import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { UserModule } from 'src/engine/core-modules/user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkspaceOidcProviderEntity]),
    AuthModule,
    UserModule,
    GuardRedirectModule,
    WorkspaceDomainsModule,
    SecretEncryptionModule,
    SecureHttpClientModule,
    PermissionsModule,
  ],
  controllers: [OidcSsoAuthController],
  providers: [
    CreateWorkspaceOidcProviderFastInstanceCommand,
    OidcProviderService,
    OidcProtocolService,
    OidcAccountService,
    OidcProviderResolver,
    PublicOidcProviderResolver,
  ],
})
export class OidcSsoModule {}
