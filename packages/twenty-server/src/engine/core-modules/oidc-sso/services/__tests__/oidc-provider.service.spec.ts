import { Logger } from '@nestjs/common';

import { QueryFailedError } from 'typeorm';

import { OIDC_GLOBAL_PROVIDER_ID } from 'src/engine/core-modules/oidc-sso/constants/oidc-global-provider-id.constant';
import { OidcSsoException } from 'src/engine/core-modules/oidc-sso/oidc-sso.exception';
import { type OidcProtocolService } from 'src/engine/core-modules/oidc-sso/services/oidc-protocol.service';
import { OidcProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-provider.service';
import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const WORKSPACE_ID = 'c2a0f5d2-3a54-4b7e-9d6c-1f0e8a7b6c5d';

const globalEnv: Record<string, string> = {
  OIDC_ISSUER: 'https://idp.example.com/auth/v1',
  OIDC_CLIENT_ID: 'global-client',
  OIDC_CLIENT_SECRET: 'global-secret',
  OIDC_NAME: 'Rauthy',
};

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
  globalEnv = {},
  workspace = { id: WORKSPACE_ID },
}: {
  nodeEnv?: string;
  discoveryError?: Error;
  saveError?: Error;
  stored?: Record<string, unknown> | null;
  deleteAffected?: number;
  globalEnv?: Record<string, string>;
  workspace?: { id: string } | null;
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
  const workspaceRepository = {
    findOne: jest.fn().mockResolvedValue(workspace),
  };
  const config = {
    get: jest.fn<string | undefined, [string]>((key) =>
      key === 'NODE_ENV' ? nodeEnv : globalEnv[key],
    ),
  };

  return {
    repository,
    protocol,
    service: new OidcProviderService(
      repository as never,
      encryption as unknown as SecretEncryptionService,
      protocol as unknown as OidcProtocolService,
      config as unknown as TwentyConfigService,
      workspaceRepository as never,
    ),
    workspaceRepository,
    config,
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

  describe('with a global provider', () => {
    it('lists only the global provider as active for any workspace', async () => {
      const { service, repository } = buildService({ globalEnv });

      await expect(
        service.findActiveByWorkspace('workspace-a'),
      ).resolves.toEqual([
        expect.objectContaining({
          id: OIDC_GLOBAL_PROVIDER_ID,
          name: 'Rauthy',
        }),
      ]);
      expect(repository.find).not.toHaveBeenCalled();
    });

    it('rejects create, update and delete', async () => {
      const { service, repository } = buildService({ globalEnv });

      await expectCode(service.create(input), 'GLOBAL_PROVIDER_ACTIVE');
      await expectCode(
        service.update({ workspaceId: 'workspace-a', id: 'p1', name: 'New' }),
        'GLOBAL_PROVIDER_ACTIVE',
      );
      await expectCode(
        service.delete({ workspaceId: 'workspace-a', id: 'p1' }),
        'GLOBAL_PROVIDER_ACTIVE',
      );
      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('resolves the global id to the workspace from the login url', async () => {
      const { service, workspaceRepository } = buildService({ globalEnv });

      await expect(
        service.findByIdWithWorkspace(OIDC_GLOBAL_PROVIDER_ID, WORKSPACE_ID),
      ).resolves.toMatchObject({
        id: OIDC_GLOBAL_PROVIDER_ID,
        workspaceId: WORKSPACE_ID,
        status: 'active',
        clientId: 'global-client',
      });
      expect(workspaceRepository.findOne).toHaveBeenCalledWith({
        where: { id: WORKSPACE_ID },
      });
    });

    it.each([undefined, 'not-a-uuid'])(
      'refuses the global id without a usable workspace id (%s)',
      async (workspaceId) => {
        const { service, workspaceRepository } = buildService({ globalEnv });

        await expect(
          service.findByIdWithWorkspace(OIDC_GLOBAL_PROVIDER_ID, workspaceId),
        ).resolves.toBeNull();
        expect(workspaceRepository.findOne).not.toHaveBeenCalled();
      },
    );

    it('refuses an unknown workspace', async () => {
      const { service } = buildService({ globalEnv, workspace: null });

      await expect(
        service.findByIdWithWorkspace(OIDC_GLOBAL_PROVIDER_ID, WORKSPACE_ID),
      ).resolves.toBeNull();
    });

    it('ignores stored providers while it is on', async () => {
      const { service, repository } = buildService({ globalEnv });

      await expect(
        service.findByIdWithWorkspace(
          '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
          WORKSPACE_ID,
        ),
      ).resolves.toBeNull();
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('returns the plaintext secret from env', () => {
      const { service } = buildService({ globalEnv });

      expect(
        service.decryptClientSecret({
          id: OIDC_GLOBAL_PROVIDER_ID,
          workspaceId: WORKSPACE_ID,
        }),
      ).toBe('global-secret');
    });
  });

  describe('without a global provider', () => {
    it('ignores a workspace id for a stored provider', async () => {
      const { service, repository } = buildService();

      await service.findByIdWithWorkspace(
        '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        WORKSPACE_ID,
      );

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' },
        relations: { workspace: true },
      });
    });

    it('warns once per kind of misconfiguration and again after it was fixed', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { service, config } = buildService({
        globalEnv: { OIDC_ISSUER: globalEnv.OIDC_ISSUER },
      });

      service.getGlobalProvider();
      service.getGlobalProvider();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenLastCalledWith(
        expect.stringContaining('must all be set'),
      );

      config.get.mockImplementation((key: string) => globalEnv[key]);
      expect(service.getGlobalProvider()).not.toBeNull();

      config.get.mockImplementation(
        (key: string) => ({ ...globalEnv, OIDC_ISSUER: 'not a url' })[key],
      );
      service.getGlobalProvider();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenLastCalledWith(
        expect.stringContaining('not a valid https URL'),
      );

      warn.mockRestore();
    });

    it('stays off with only part of the variables or a bad issuer', () => {
      const { service: partial } = buildService({
        globalEnv: { OIDC_ISSUER: globalEnv.OIDC_ISSUER },
      });
      const { service: badIssuer } = buildService({
        globalEnv: { ...globalEnv, OIDC_ISSUER: 'http://idp.example.com' },
      });

      expect(partial.getGlobalProvider()).toBeNull();
      expect(badIssuer.getGlobalProvider()).toBeNull();
    });
  });
});
