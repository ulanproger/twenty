import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined, isValidUuid } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { type OidcGlobalLoginProvider } from 'src/engine/core-modules/oidc-sso/types/oidc-login-provider.type';
import {
  type OidcGlobalProvider,
  readOidcGlobalProvider,
  type ReadOidcGlobalProviderResult,
} from 'src/engine/core-modules/oidc-sso/utils/read-oidc-global-provider.util';
import { NodeEnvironment } from 'src/engine/core-modules/twenty-config/interfaces/node-environment.interface';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

type OidcGlobalProviderProblem = Exclude<
  ReadOidcGlobalProviderResult['status'],
  'on' | 'off'
>;

const PROBLEM_WARNINGS: Record<OidcGlobalProviderProblem, string> = {
  incomplete:
    'OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET must all be set. Single sign-on through OIDC and per-workspace OIDC setup stay disabled until they are',
  'invalid-issuer':
    'OIDC_ISSUER is not a valid https URL. Single sign-on through OIDC and per-workspace OIDC setup stay disabled until it is fixed',
};

@Injectable()
export class OidcGlobalProviderService {
  private readonly logger = new Logger(OidcGlobalProviderService.name);
  private lastWarnedProblem: OidcGlobalProviderProblem | null = null;

  constructor(
    private readonly twentyConfigService: TwentyConfigService,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {}

  resolve(): ReadOidcGlobalProviderResult {
    const result = readOidcGlobalProvider({
      issuer: this.twentyConfigService.get('OIDC_ISSUER'),
      clientId: this.twentyConfigService.get('OIDC_CLIENT_ID'),
      clientSecret: this.twentyConfigService.get('OIDC_CLIENT_SECRET'),
      name: this.twentyConfigService.get('OIDC_NAME'),
      isDevelopment:
        this.twentyConfigService.get('NODE_ENV') ===
        NodeEnvironment.DEVELOPMENT,
    });

    // One warning per kind of problem, repeated only after the setup was fixed and broken again.
    const problem =
      result.status === 'on' || result.status === 'off' ? null : result.status;

    if (problem !== this.lastWarnedProblem) {
      this.lastWarnedProblem = problem;

      if (problem !== null) {
        this.logger.warn(PROBLEM_WARNINGS[problem]);
      }
    }

    return result;
  }

  // The provider has no workspace of its own, it signs users into the one named by the login URL.
  async findLoginProvider(
    globalProvider: OidcGlobalProvider,
    workspaceId: string | undefined,
  ): Promise<OidcGlobalLoginProvider | null> {
    if (!isDefined(workspaceId) || !isValidUuid(workspaceId)) {
      return null;
    }

    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
    });

    if (workspace === null) {
      return null;
    }

    return {
      id: globalProvider.id,
      workspaceId: workspace.id,
      status: 'active',
      issuer: globalProvider.issuer,
      clientId: globalProvider.clientId,
      workspace,
      isGlobal: true,
    };
  }
}
