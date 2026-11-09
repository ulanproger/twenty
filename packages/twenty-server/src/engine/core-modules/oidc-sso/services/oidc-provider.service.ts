import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  assertIsDefinedOrThrow,
  isDefined,
  isValidUuid,
} from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { OIDC_GLOBAL_PROVIDER_ID } from 'src/engine/core-modules/oidc-sso/constants/oidc-global-provider-id.constant';
import { WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import { OidcSsoException } from 'src/engine/core-modules/oidc-sso/oidc-sso.exception';
import { OidcProtocolService } from 'src/engine/core-modules/oidc-sso/services/oidc-protocol.service';
import { isOidcIssuerSchemeAllowed } from 'src/engine/core-modules/oidc-sso/utils/is-oidc-issuer-scheme-allowed.util';
import { normalizeOidcIssuer } from 'src/engine/core-modules/oidc-sso/utils/normalize-oidc-issuer.util';
import { type PlaintextString } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { NodeEnvironment } from 'src/engine/core-modules/twenty-config/interfaces/node-environment.interface';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type OidcLoginProvider } from 'src/engine/core-modules/oidc-sso/types/oidc-login-provider.type';
import {
  type OidcGlobalProvider,
  readOidcGlobalProvider,
} from 'src/engine/core-modules/oidc-sso/utils/read-oidc-global-provider.util';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { isUniqueViolationError } from 'src/engine/metadata-modules/ai/ai-chat/utils/is-unique-violation-error.util';

@Injectable()
export class OidcProviderService {
  private readonly logger = new Logger(OidcProviderService.name);
  private hasWarnedAboutInvalidGlobalIssuer = false;

  constructor(
    // The public login and callback routes know only the provider id, so every
    // admin query below scopes by workspaceId by hand.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(WorkspaceOidcProviderEntity)
    private readonly oidcProviderRepository: Repository<WorkspaceOidcProviderEntity>,
    private readonly secretEncryptionService: SecretEncryptionService,
    private readonly oidcProtocolService: OidcProtocolService,
    private readonly twentyConfigService: TwentyConfigService,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {}

  // The platform-wide provider from env. While it is on, stored providers are ignored.
  getGlobalProvider() {
    const result = readOidcGlobalProvider({
      issuer: this.twentyConfigService.get('OIDC_ISSUER'),
      clientId: this.twentyConfigService.get('OIDC_CLIENT_ID'),
      clientSecret: this.twentyConfigService.get('OIDC_CLIENT_SECRET'),
      name: this.twentyConfigService.get('OIDC_NAME'),
      isDevelopment:
        this.twentyConfigService.get('NODE_ENV') ===
        NodeEnvironment.DEVELOPMENT,
    });

    if (
      result.status === 'invalid-issuer' &&
      !this.hasWarnedAboutInvalidGlobalIssuer
    ) {
      this.hasWarnedAboutInvalidGlobalIssuer = true;
      this.logger.warn(
        'OIDC_ISSUER is not a valid https URL, the global OIDC provider stays off',
      );
    }

    return result.status === 'on' ? result.provider : null;
  }

  // workspaceId matters only for the global provider, which has no workspace of its own.
  async findByIdWithWorkspace(
    providerId: string,
    workspaceId?: string,
  ): Promise<OidcLoginProvider | null> {
    const globalProvider = this.getGlobalProvider();

    if (globalProvider !== null) {
      return providerId === globalProvider.id
        ? await this.buildGlobalLoginProvider(globalProvider, workspaceId)
        : null;
    }

    // A malformed id would make Postgres throw instead of returning no row.
    if (!isValidUuid(providerId)) {
      return null;
    }

    return await this.oidcProviderRepository.findOne({
      where: { id: providerId },
      relations: { workspace: true },
    });
  }

  private async buildGlobalLoginProvider(
    globalProvider: OidcGlobalProvider,
    workspaceId: string | undefined,
  ): Promise<OidcLoginProvider | null> {
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
    };
  }

  private assertNoGlobalProvider() {
    if (this.getGlobalProvider() !== null) {
      throw new OidcSsoException(
        'OIDC is configured for the whole platform',
        'GLOBAL_PROVIDER_ACTIVE',
      );
    }
  }

  async findAllByWorkspace(workspaceId: string) {
    return await this.oidcProviderRepository.find({
      where: { workspaceId },
      order: { createdAt: 'ASC' },
    });
  }

  async findActiveByWorkspace(
    workspaceId: string,
  ): Promise<Pick<WorkspaceOidcProviderEntity, 'id' | 'name'>[]> {
    const globalProvider = this.getGlobalProvider();

    if (globalProvider !== null) {
      return [globalProvider];
    }

    return await this.oidcProviderRepository.find({
      where: { workspaceId, status: 'active' },
      order: { createdAt: 'ASC' },
    });
  }

  // Returns the plaintext secret of either kind of provider.
  decryptClientSecret(
    provider: Pick<OidcLoginProvider, 'id' | 'clientSecret' | 'workspaceId'>,
  ): string {
    if (provider.id === OIDC_GLOBAL_PROVIDER_ID) {
      const globalProvider = this.getGlobalProvider();

      assertIsDefinedOrThrow(
        globalProvider,
        new Error('Global OIDC provider is not configured'),
      );

      return globalProvider.clientSecret;
    }

    assertIsDefinedOrThrow(
      provider.clientSecret,
      new Error('OIDC provider has no stored client secret'),
    );

    return this.secretEncryptionService.decryptVersionedOrThrow(
      provider.clientSecret,
      { workspaceId: provider.workspaceId },
    );
  }

  async create({
    workspaceId,
    name,
    issuer,
    clientId,
    clientSecret,
  }: {
    workspaceId: string;
    name: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
  }) {
    this.assertNoGlobalProvider();

    const normalizedIssuer = normalizeOidcIssuer(issuer);

    if (normalizedIssuer === null) {
      throw new OidcSsoException('Invalid OIDC issuer URL', 'INVALID_ISSUER');
    }

    if (
      !isOidcIssuerSchemeAllowed({
        issuer: normalizedIssuer,
        isDevelopment:
          this.twentyConfigService.get('NODE_ENV') ===
          NodeEnvironment.DEVELOPMENT,
      })
    ) {
      throw new OidcSsoException(
        'OIDC issuer must use https',
        'INVALID_ISSUER',
      );
    }

    await this.oidcProtocolService.assertIssuerDiscoverable(normalizedIssuer);

    try {
      return await this.oidcProviderRepository.save(
        this.oidcProviderRepository.create({
          workspaceId,
          name,
          issuer: normalizedIssuer,
          clientId,
          clientSecret: this.secretEncryptionService.encryptVersioned(
            clientSecret as PlaintextString,
            { workspaceId },
          ),
        }),
      );
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new OidcSsoException(
          'OIDC provider with this issuer and client id already exists',
          'PROVIDER_ALREADY_EXISTS',
        );
      }

      throw error;
    }
  }

  async update({
    workspaceId,
    id,
    name,
    status,
  }: {
    workspaceId: string;
    id: string;
    name?: string;
    status?: WorkspaceOidcProviderEntity['status'];
  }) {
    this.assertNoGlobalProvider();

    const provider = await this.oidcProviderRepository.findOne({
      where: { id, workspaceId },
    });

    if (provider === null) {
      throw new OidcSsoException(
        'OIDC provider not found',
        'PROVIDER_NOT_FOUND',
      );
    }

    if (isDefined(name)) {
      provider.name = name;
    }

    if (isDefined(status)) {
      provider.status = status;
    }

    return await this.oidcProviderRepository.save(provider);
  }

  async delete({ workspaceId, id }: { workspaceId: string; id: string }) {
    this.assertNoGlobalProvider();

    const { affected } = await this.oidcProviderRepository.delete({
      id,
      workspaceId,
    });

    if (affected === 0) {
      throw new OidcSsoException(
        'OIDC provider not found',
        'PROVIDER_NOT_FOUND',
      );
    }
  }
}
