import { QueryFailedError } from 'typeorm';

import { OidcSsoException } from 'src/engine/core-modules/oidc-sso/oidc-sso.exception';
import { type OidcProtocolService } from 'src/engine/core-modules/oidc-sso/services/oidc-protocol.service';
import { OidcProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-provider.service';
import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const input = {
  workspaceId: 'workspace-a',
  name: 'Okta',
  issuer: 'https://idp.example.com/',
  clientId: 'client-1',
  clientSecret: 'secret-1',
};

const buildService = ({
  nodeEnv = 'production',
  discoveryError,
  saveError,
  stored = {
    id: 'p1',
    workspaceId: 'workspace-a',
    name: 'Old',
    status: 'active',
  },
  deleteAffected = 1,
}: {
  nodeEnv?: string;
  discoveryError?: Error;
  saveError?: Error;
  stored?: Record<string, unknown> | null;
  deleteAffected?: number;
} = {}) => {
  const repository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => {
      if (saveError !== undefined) {
        throw saveError;
      }

      return value;
    }),
    findOne: jest.fn().mockResolvedValue(stored),
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue({ affected: deleteAffected }),
  };
  const protocol = {
    assertIssuerDiscoverable: jest.fn(async () => {
      if (discoveryError !== undefined) {
        throw discoveryError;
      }
    }),
  };
  const encryption = {
    encryptVersioned: jest.fn((plaintext: string) => `enc:v2:${plaintext}`),
  };
  const config = { get: jest.fn(() => nodeEnv) };

  return {
    repository,
    protocol,
    service: new OidcProviderService(
      repository as never,
      encryption as unknown as SecretEncryptionService,
      protocol as unknown as OidcProtocolService,
      config as unknown as TwentyConfigService,
    ),
  };
};

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toBeInstanceOf(OidcSsoException);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('OidcProviderService', () => {
  describe('create', () => {
    it('stores the normalized issuer and an encrypted secret', async () => {
      const { service, repository } = buildService();

      await service.create(input);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          issuer: 'https://idp.example.com',
          clientSecret: 'enc:v2:secret-1',
        }),
      );
    });

    it('rejects an unparsable issuer', async () => {
      const { service, repository } = buildService();

      await expectCode(
        service.create({ ...input, issuer: 'not a url' }),
        'INVALID_ISSUER',
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects http outside development', async () => {
      const { service } = buildService();

      await expectCode(
        service.create({ ...input, issuer: 'http://idp.example.com' }),
        'INVALID_ISSUER',
      );
    });

    it('allows http in development', async () => {
      const { service, repository } = buildService({ nodeEnv: 'development' });

      await service.create({ ...input, issuer: 'http://localhost:8085/idp-a' });

      expect(repository.save).toHaveBeenCalled();
    });

    it('does not save when discovery fails', async () => {
      const { service, repository } = buildService({
        discoveryError: new OidcSsoException('boom', 'ISSUER_DISCOVERY_FAILED'),
      });

      await expectCode(service.create(input), 'ISSUER_DISCOVERY_FAILED');
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('maps a unique violation to PROVIDER_ALREADY_EXISTS', async () => {
      const violation = Object.assign(
        new QueryFailedError('insert', [], new Error('duplicate')),
        { code: '23505' },
      );
      const { service } = buildService({ saveError: violation });

      await expectCode(service.create(input), 'PROVIDER_ALREADY_EXISTS');
    });
  });

  describe('update', () => {
    it('looks the provider up inside the caller workspace', async () => {
      const { service, repository } = buildService();

      await service.update({
        workspaceId: 'workspace-a',
        id: 'p1',
        status: 'inactive',
      });

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'p1', workspaceId: 'workspace-a' },
      });
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Old', status: 'inactive' }),
      );
    });

    it('ignores an explicit null name and status instead of writing them', async () => {
      const { service, repository } = buildService();

      await service.update({
        workspaceId: 'workspace-a',
        id: 'p1',
        name: null as unknown as string,
        status: null as unknown as 'active',
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Old', status: 'active' }),
      );
    });

    it('treats a provider of another workspace as not found', async () => {
      const { service, repository } = buildService({ stored: null });

      await expectCode(
        service.update({ workspaceId: 'workspace-b', id: 'p1', name: 'X' }),
        'PROVIDER_NOT_FOUND',
      );
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes only inside the caller workspace', async () => {
      const { service, repository } = buildService();

      await service.delete({ workspaceId: 'workspace-a', id: 'p1' });

      expect(repository.delete).toHaveBeenCalledWith({
        id: 'p1',
        workspaceId: 'workspace-a',
      });
    });

    it('reports not found when nothing was deleted', async () => {
      const { service } = buildService({ deleteAffected: 0 });

      await expectCode(
        service.delete({ workspaceId: 'workspace-b', id: 'p1' }),
        'PROVIDER_NOT_FOUND',
      );
    });
  });

  describe('findActiveByWorkspace', () => {
    it('filters by workspace and active status', async () => {
      const { service, repository } = buildService();

      await service.findActiveByWorkspace('workspace-a');

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'workspace-a', status: 'active' },
        }),
      );
    });
  });
});
