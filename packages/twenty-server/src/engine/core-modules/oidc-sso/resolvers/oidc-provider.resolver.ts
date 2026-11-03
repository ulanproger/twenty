import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { PreventNestToAutoLogGraphqlErrorsFilter } from 'src/engine/core-modules/graphql/filters/prevent-nest-to-auto-log-graphql-errors.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { CreateOidcProviderInput } from 'src/engine/core-modules/oidc-sso/dtos/create-oidc-provider.input';
import { DeleteOidcProviderInput } from 'src/engine/core-modules/oidc-sso/dtos/delete-oidc-provider.input';
import { OidcProviderDTO } from 'src/engine/core-modules/oidc-sso/dtos/oidc-provider.dto';
import { UpdateOidcProviderInput } from 'src/engine/core-modules/oidc-sso/dtos/update-oidc-provider.input';
import { OidcSsoGraphqlApiExceptionFilter } from 'src/engine/core-modules/oidc-sso/filters/oidc-sso-graphql-api-exception.filter';
import { OidcProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-provider.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { AuthPrincipalGuard } from 'src/engine/guards/auth-principal.guard';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { PermissionsGraphqlApiExceptionFilter } from 'src/engine/metadata-modules/permissions/utils/permissions-graphql-api-exception.filter';

// Picks fields explicitly so the encrypted client secret can never leak by spread.
const toOidcProviderDTO = ({
  id,
  name,
  issuer,
  clientId,
  status,
  createdAt,
  updatedAt,
}: OidcProviderDTO): OidcProviderDTO => ({
  id,
  name,
  issuer,
  clientId,
  status,
  createdAt,
  updatedAt,
});

@MetadataResolver()
@UseFilters(
  PermissionsGraphqlApiExceptionFilter,
  PreventNestToAutoLogGraphqlErrorsFilter,
  AuthGraphqlApiExceptionFilter,
  OidcSsoGraphqlApiExceptionFilter,
)
@UsePipes(ResolverValidationPipe)
@UseGuards(
  AuthPrincipalGuard({
    userSession: {
      standard: true,
      impersonated: false,
      playground: false,
      workspaceAgnostic: false,
    },
    apiKey: false,
    oauthClient: false,
    application: false,
  }),
  SettingsPermissionGuard(PermissionFlagType.SECURITY),
)
export class OidcProviderResolver {
  constructor(private readonly oidcProviderService: OidcProviderService) {}

  @Query(() => [OidcProviderDTO])
  async oidcProviders(
    @AuthWorkspace() { id: workspaceId }: WorkspaceEntity,
  ): Promise<OidcProviderDTO[]> {
    const providers =
      await this.oidcProviderService.findAllByWorkspace(workspaceId);

    return providers.map(toOidcProviderDTO);
  }

  @Mutation(() => OidcProviderDTO)
  async createOidcProvider(
    @Args('input') input: CreateOidcProviderInput,
    @AuthWorkspace() { id: workspaceId }: WorkspaceEntity,
  ): Promise<OidcProviderDTO> {
    return toOidcProviderDTO(
      await this.oidcProviderService.create({ workspaceId, ...input }),
    );
  }

  @Mutation(() => OidcProviderDTO)
  async updateOidcProvider(
    @Args('input') input: UpdateOidcProviderInput,
    @AuthWorkspace() { id: workspaceId }: WorkspaceEntity,
  ): Promise<OidcProviderDTO> {
    return toOidcProviderDTO(
      await this.oidcProviderService.update({ workspaceId, ...input }),
    );
  }

  @Mutation(() => Boolean)
  async deleteOidcProvider(
    @Args('input') { id }: DeleteOidcProviderInput,
    @AuthWorkspace() { id: workspaceId }: WorkspaceEntity,
  ): Promise<boolean> {
    await this.oidcProviderService.delete({ workspaceId, id });

    return true;
  }
}
