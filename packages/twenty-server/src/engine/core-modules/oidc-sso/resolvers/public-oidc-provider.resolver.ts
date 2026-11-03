import { UseFilters, UseGuards } from '@nestjs/common';
import { Args, Query } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { PreventNestToAutoLogGraphqlErrorsFilter } from 'src/engine/core-modules/graphql/filters/prevent-nest-to-auto-log-graphql-errors.filter';
import { PublicOidcProviderDTO } from 'src/engine/core-modules/oidc-sso/dtos/public-oidc-provider.dto';
import { OidcProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-provider.service';
import { buildOidcLoginUrl } from 'src/engine/core-modules/oidc-sso/utils/build-oidc-login-url.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceNotFoundDefaultError } from 'src/engine/core-modules/workspace/workspace.exception';
import { AllowSuspendedWorkspace } from 'src/engine/decorators/auth/allow-suspended-workspace.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

@MetadataResolver()
@UseFilters(PreventNestToAutoLogGraphqlErrorsFilter)
export class PublicOidcProviderResolver {
  constructor(
    private readonly oidcProviderService: OidcProviderService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  @Query(() => [PublicOidcProviderDTO])
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  @AllowSuspendedWorkspace()
  async publicOidcProviders(
    @Args('origin') origin: string,
  ): Promise<PublicOidcProviderDTO[]> {
    const workspace = await this.findWorkspace(origin);

    if (workspace === undefined) {
      return [];
    }

    const serverUrl = this.twentyConfigService.get('SERVER_URL');
    const providers = await this.oidcProviderService.findActiveByWorkspace(
      workspace.id,
    );

    return providers.map(({ id, name }) => ({
      id,
      name,
      loginUrl: buildOidcLoginUrl(serverUrl, id),
    }));
  }

  // The default-workspace lookup throws this sentinel when the instance has no workspace.
  private async findWorkspace(origin: string) {
    try {
      return await this.workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
        origin,
      );
    } catch (error) {
      if (error === WorkspaceNotFoundDefaultError) {
        return undefined;
      }

      throw error;
    }
  }
}
