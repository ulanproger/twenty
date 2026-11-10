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
import {
  toOidcGlobalProviderDTO,
  toOidcProviderDTO,
} from 'src/engine/core-modules/oidc-sso/utils/to-oidc-provider-dto.util';
import { OidcSsoGraphqlApiExceptionFilter } from 'src/engine/core-modules/oidc-sso/filters/oidc-sso-graphql-api-exception.filter';
import { OidcGlobalProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-global-provider.service';
import { OidcProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-provider.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { AccessPolicyGuard } from 'src/engine/guards/access-policy.guard';
import { PermissionsGraphqlApiExceptionFilter } from 'src/engine/permissions/utils/permissions-graphql-api-exception.filter';

@MetadataResolver()
@UseFilters(
  PermissionsGraphqlApiExceptionFilter,
  PreventNestToAutoLogGraphqlErrorsFilter,
  AuthGraphqlApiExceptionFilter,
  OidcSsoGraphqlApiExceptionFilter,
)
@UsePipes(ResolverValidationPipe)
@UseGuards(
  AccessPolicyGuard({
    authPrincipals: {
      userSession: {
        standard: true,
        impersonated: false,
        playground: false,
        workspaceAgnostic: false,
      },
      apiKey: false,
      oauthClient: false,
      application: false,
    },
    requiredPermissionFlags: [PermissionFlagType.SECURITY],
  }),
)
export class OidcProviderResolver {
  constructor(
    private readonly oidcProviderService: OidcProviderService,
    private readonly oidcGlobalProviderService: OidcGlobalProviderService,
  ) {}

  @Query(() => [OidcProviderDTO])
  async oidcProviders(
    @AuthWorkspace() { id: workspaceId }: WorkspaceEntity,
  ): Promise<OidcProviderDTO[]> {
    const global = this.oidcGlobalProviderService.resolve();

    if (global.status !== 'off') {
      return global.status === 'on'
        ? [toOidcGlobalProviderDTO(global.provider)]
        : [];
    }

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
      await this.oidcProviderService.create({ ...input, workspaceId }),
    );
  }

  @Mutation(() => OidcProviderDTO)
  async updateOidcProvider(
    @Args('input') input: UpdateOidcProviderInput,
    @AuthWorkspace() { id: workspaceId }: WorkspaceEntity,
  ): Promise<OidcProviderDTO> {
    return toOidcProviderDTO(
      await this.oidcProviderService.update({ ...input, workspaceId }),
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
