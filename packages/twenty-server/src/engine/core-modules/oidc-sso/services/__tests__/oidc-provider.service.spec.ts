import { QueryFailedError } from 'typeorm';

import { OIDC_GLOBAL_PROVIDER_ID } from 'src/engine/core-modules/oidc-sso/constants/oidc-global-provider-id.constant';
import { OidcSsoException } from 'src/engine/core-modules/oidc-sso/oidc-sso.exception';
import { type OidcGlobalProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-global-provider.service';
import { type OidcProtocolService } from 'src/engine/core-modules/oidc-sso/services/oidc-protocol.service';
import { OidcProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-provider.service';
import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const WORKSPACE_ID = 'c2a0f5d2-3a54-4b7e-9d6c-1f0e8a7b6c5d';

const globalProvider = {
  id: OIDC_GLOBAL_PROVIDER_ID,
  name: 'Rauthy',
  issuer: 'https://idp.example.com/auth/v1',
  clientId: 'global-client',
  clientSecret: 'global-secret',
};

const onState = { status: 'on', provider: globalProvider };

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
  globalState = { status: 'off' },
  globalLoginProvider = null,
}: {
  nodeEnv?: string;
  discoveryError?: Error;
  saveError?: Error;
  stored?: Record<string, unknown> | null;
  deleteAffected?: number;
  globalState?: { status: string; provider?: typeof globalProvider };
  globalLoginProvider?: object | null;
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
  const globalProviderService = {
    resolve: jest.fn(() => globalState),
    findLoginProvider: jest.fn().mockResolvedValue(globalLoginProvider),
  };

  return {
    repository,
    protocol,
    globalProviderService,
    service: new OidcProviderService(
      repository as never,
      encryption as unknown as SecretEncryptionService,
      protocol as unknown as OidcProtocolService,
      config as unknown as TwentyConfigService,
      globalProviderService as unknown as OidcGlobalProviderService,
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

    it('returns only id, name and a false global flag for stored providers', async () => {
      const { service, repository } = buildService();

      repository.find.mockResolvedValue([
        { id: 'p1', name: 'Okta', clientSecret: 'enc:v2:secret' },
      ]);

      await expect(
        service.findActiveByWorkspace('workspace-a'),
      ).resolves.toEqual([{ id: 'p1', name: 'Okta', isGlobal: false }]);
    });
  });

  describe('with a global provider', () => {
    it('lists only the global provider as active for any workspace', async () => {
      const { service, repository } = buildService({ globalState: onState });

      await expect(
        service.findActiveByWorkspace('workspace-a'),
      ).resolves.toEqual([
        { id: OIDC_GLOBAL_PROVIDER_ID, name: 'Rauthy', isGlobal: true },
      ]);
      expect(repository.find).not.toHaveBeenCalled();
    });

    it('rejects create, update and delete', async () => {
      const { service, repository } = buildService({ globalState: onState });

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

    it('hands the global id and the login url workspace to the global service', async () => {
      const loginProvider = { id: OIDC_GLOBAL_PROVIDER_ID, isGlobal: true };
      const { service, globalProviderService } = buildService({
        globalState: onState,
        globalLoginProvider: loginProvider,
      });

      await expect(
        service.findByIdWithWorkspace(OIDC_GLOBAL_PROVIDER_ID, WORKSPACE_ID),
      ).resolves.toBe(loginProvider);
      expect(globalProviderService.findLoginProvider).toHaveBeenCalledWith(
        globalProvider,
        WORKSPACE_ID,
      );
    });

    it('ignores stored providers while it is on', async () => {
      const { service, repository } = buildService({ globalState: onState });

      await expect(
        service.findByIdWithWorkspace(
          '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
          WORKSPACE_ID,
        ),
      ).resolves.toBeNull();
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('returns the plaintext secret from the global service for the global provider', () => {
      const { service } = buildService({ globalState: onState });

      expect(
        service.decryptClientSecret({
          id: OIDC_GLOBAL_PROVIDER_ID,
          workspaceId: WORKSPACE_ID,
          isGlobal: true,
        } as never),
      ).toBe('global-secret');
    });
  });

  describe('with a broken global setup', () => {
    const brokenState = { status: 'incomplete' };

    it('offers no sign-in and ignores stored providers', async () => {
      const { service, repository } = buildService({
        globalState: brokenState,
      });

      await expect(
        service.findActiveByWorkspace('workspace-a'),
      ).resolves.toEqual([]);
      await expect(
        service.findByIdWithWorkspace(
          '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
          WORKSPACE_ID,
        ),
      ).resolves.toBeNull();
      await expect(
        service.findByIdWithWorkspace(OIDC_GLOBAL_PROVIDER_ID, WORKSPACE_ID),
      ).resolves.toBeNull();
      expect(repository.find).not.toHaveBeenCalled();
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('rejects create, update and delete like a working setup', async () => {
      const { service, repository } = buildService({
        globalState: brokenState,
      });

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

    it('marks a stored provider as not global', async () => {
      const { service } = buildService({
        stored: { id: 'p1', workspaceId: 'workspace-a', clientSecret: 'enc' },
      });

      await expect(
        service.findByIdWithWorkspace('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'),
      ).resolves.toMatchObject({ id: 'p1', isGlobal: false });
    });
  });
});
