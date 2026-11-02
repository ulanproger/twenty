import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import { CreateWorkspaceOidcProviderFastInstanceCommand } from 'src/engine/core-modules/oidc-sso/migrations/1793640971352-create-workspace-oidc-provider.fast-instance-command';

@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceOidcProviderEntity])],
  providers: [CreateWorkspaceOidcProviderFastInstanceCommand],
})
export class OidcSsoModule {}
