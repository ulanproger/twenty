import { Logger } from '@nestjs/common';

import { OIDC_GLOBAL_PROVIDER_ID } from 'src/engine/core-modules/oidc-sso/constants/oidc-global-provider-id.constant';
import { OidcGlobalProviderService } from 'src/engine/core-modules/oidc-sso/services/oidc-global-provider.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const WORKSPACE_ID = 'c2a0f5d2-3a54-4b7e-9d6c-1f0e8a7b6c5d';

const completeEnv: Record<string, string> = {
  OIDC_ISSUER: 'https://idp.example.com/auth/v1',
  OIDC_CLIENT_ID: 'global-client',
  OIDC_CLIENT_SECRET: 'global-secret',
  OIDC_NAME: 'Rauthy',
};

const buildService = ({
  env = completeEnv,
  workspace = { id: WORKSPACE_ID },
}: {
  env?: Record<string, string>;
  workspace?: { id: string } | null;
} = {}) => {
  const config = {
    get: jest.fn<string | undefined, [string]>((key) =>
      key === 'NODE_ENV' ? 'production' : env[key],
    ),
  };
  const workspaceRepository = {
    findOne: jest.fn().mockResolvedValue(workspace),
  };

  return {
    config,
    workspaceRepository,
    service: new OidcGlobalProviderService(
      config as unknown as TwentyConfigService,
      workspaceRepository as never,
    ),
  };
};

describe('OidcGlobalProviderService', () => {
  describe('get', () => {
    it('returns the provider when everything is set', () => {
      expect(buildService().service.get()).toMatchObject({
        id: OIDC_GLOBAL_PROVIDER_ID,
        name: 'Rauthy',
        clientId: 'global-client',
      });
    });

    it('stays off without variables, with only part of them or with a bad issuer', () => {
      expect(buildService({ env: {} }).service.get()).toBeNull();
      expect(
        buildService({
          env: { OIDC_ISSUER: completeEnv.OIDC_ISSUER },
        }).service.get(),
      ).toBeNull();
      expect(
        buildService({
          env: { ...completeEnv, OIDC_ISSUER: 'http://idp.example.com' },
        }).service.get(),
      ).toBeNull();
    });

    it('warns once per kind of misconfiguration and again after it was fixed', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { service, config } = buildService({
        env: { OIDC_ISSUER: completeEnv.OIDC_ISSUER },
      });

      service.get();
      service.get();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenLastCalledWith(
        expect.stringContaining('must all be set'),
      );

      config.get.mockImplementation((key: string) => completeEnv[key]);
      expect(service.get()).not.toBeNull();

      config.get.mockImplementation(
        (key: string) => ({ ...completeEnv, OIDC_ISSUER: 'not a url' })[key],
      );
      service.get();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenLastCalledWith(
        expect.stringContaining('not a valid https URL'),
      );

      warn.mockRestore();
    });

    it('does not warn when nothing is configured', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      buildService({ env: {} }).service.get();

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('findLoginProvider', () => {
    it('binds the provider to the workspace of the login url', async () => {
      const { service, workspaceRepository } = buildService();

      await expect(service.findLoginProvider(WORKSPACE_ID)).resolves.toEqual(
        expect.objectContaining({
          id: OIDC_GLOBAL_PROVIDER_ID,
          workspaceId: WORKSPACE_ID,
          status: 'active',
          isGlobal: true,
        }),
      );
      expect(workspaceRepository.findOne).toHaveBeenCalledWith({
        where: { id: WORKSPACE_ID },
      });
    });

    it('never carries the secret', async () => {
      const provider =
        await buildService().service.findLoginProvider(WORKSPACE_ID);

      expect(JSON.stringify(provider)).not.toContain('global-secret');
    });

    it.each([undefined, 'not-a-uuid'])(
      'refuses a missing or malformed workspace id (%s)',
      async (workspaceId) => {
        const { service, workspaceRepository } = buildService();

        await expect(
          service.findLoginProvider(workspaceId),
        ).resolves.toBeNull();
        expect(workspaceRepository.findOne).not.toHaveBeenCalled();
      },
    );

    it('refuses an unknown workspace', async () => {
      const { service } = buildService({ workspace: null });

      await expect(service.findLoginProvider(WORKSPACE_ID)).resolves.toBeNull();
    });

    it('returns nothing while the provider is off', async () => {
      const { service, workspaceRepository } = buildService({ env: {} });

      await expect(service.findLoginProvider(WORKSPACE_ID)).resolves.toBeNull();
      expect(workspaceRepository.findOne).not.toHaveBeenCalled();
    });
  });
});
