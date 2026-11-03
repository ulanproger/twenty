import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isValidUuid } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';
import { normalizeOidcIssuer } from 'src/engine/core-modules/oidc-sso/utils/normalize-oidc-issuer.util';
import { type PlaintextString } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';

@Injectable()
export class OidcProviderService {
  constructor(
    // Public login and callback routes know only the provider id; the workspace is derived from it.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(WorkspaceOidcProviderEntity)
    private readonly oidcProviderRepository: Repository<WorkspaceOidcProviderEntity>,
    private readonly secretEncryptionService: SecretEncryptionService,
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
      throw new Error(`Invalid OIDC issuer: ${issuer}`);
    }

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
  }
}
