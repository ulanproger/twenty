import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isValidUuid } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import { OidcSsoException } from 'src/engine/core-modules/oidc-sso/oidc-sso.exception';
import { OidcProtocolService } from 'src/engine/core-modules/oidc-sso/services/oidc-protocol.service';
import { isOidcIssuerSchemeAllowed } from 'src/engine/core-modules/oidc-sso/utils/is-oidc-issuer-scheme-allowed.util';
import { normalizeOidcIssuer } from 'src/engine/core-modules/oidc-sso/utils/normalize-oidc-issuer.util';
import { type PlaintextString } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { NodeEnvironment } from 'src/engine/core-modules/twenty-config/interfaces/node-environment.interface';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { isUniqueViolationError } from 'src/engine/metadata-modules/ai/ai-chat/utils/is-unique-violation-error.util';

@Injectable()
export class OidcProviderService {
  constructor(
    // The public login and callback routes know only the provider id, so every
    // admin query below scopes by workspaceId by hand.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(WorkspaceOidcProviderEntity)
    private readonly oidcProviderRepository: Repository<WorkspaceOidcProviderEntity>,
    private readonly secretEncryptionService: SecretEncryptionService,
    private readonly oidcProtocolService: OidcProtocolService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async findByIdWithWorkspace(providerId: string) {
    // A malformed id would make Postgres throw instead of returning no row.
    if (!isValidUuid(providerId)) {
      return null;
    }

    return await this.oidcProviderRepository.findOne({
      where: { id: providerId },
      relations: { workspace: true },
    });
  }

  async findAllByWorkspace(workspaceId: string) {
    return await this.oidcProviderRepository.find({
      where: { workspaceId },
      order: { createdAt: 'ASC' },
    });
  }

  async findActiveByWorkspace(workspaceId: string) {
    return await this.oidcProviderRepository.find({
      where: { workspaceId, status: 'active' },
      order: { createdAt: 'ASC' },
    });
  }

  decryptClientSecret(
    provider: Pick<WorkspaceOidcProviderEntity, 'clientSecret' | 'workspaceId'>,
  ): string {
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
    const provider = await this.oidcProviderRepository.findOne({
      where: { id, workspaceId },
    });

    if (provider === null) {
      throw new OidcSsoException(
        'OIDC provider not found',
        'PROVIDER_NOT_FOUND',
      );
    }

    if (name !== undefined) {
      provider.name = name;
    }

    if (status !== undefined) {
      provider.status = status;
    }

    return await this.oidcProviderRepository.save(provider);
  }

  async delete({ workspaceId, id }: { workspaceId: string; id: string }) {
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
