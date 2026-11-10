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
  describe('resolve', () => {
    it('returns the provider when everything is set', () => {
      expect(buildService().service.resolve()).toMatchObject({
        status: 'on',
        provider: {
          id: OIDC_GLOBAL_PROVIDER_ID,
          name: 'Rauthy',
          clientId: 'global-client',
        },
      });
    });

    it('is off only when none of the variables is set', () => {
      expect(buildService({ env: {} }).service.resolve()).toEqual({
        status: 'off',
      });
    });

    it('is broken, not off, when the setup is partial or the issuer is bad', () => {
      expect(
        buildService({
          env: { OIDC_ISSUER: completeEnv.OIDC_ISSUER },
        }).service.resolve(),
      ).toEqual({ status: 'incomplete' });
      expect(
        buildService({
          env: { ...completeEnv, OIDC_ISSUER: 'http://idp.example.com' },
        }).service.resolve(),
      ).toEqual({ status: 'invalid-issuer' });
    });

    it('warns once per kind of misconfiguration and again after it was fixed', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { service, config } = buildService({
        env: { OIDC_ISSUER: completeEnv.OIDC_ISSUER },
      });

      service.resolve();
      service.resolve();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenLastCalledWith(
        expect.stringContaining('must all be set'),
      );

      config.get.mockImplementation((key: string) => completeEnv[key]);
      expect(service.resolve().status).toBe('on');

      config.get.mockImplementation(
        (key: string) => ({ ...completeEnv, OIDC_ISSUER: 'not a url' })[key],
      );
      service.resolve();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenLastCalledWith(
        expect.stringContaining('not a valid https URL'),
      );

      warn.mockRestore();
    });

    it('does not warn when nothing is configured', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      buildService({ env: {} }).service.resolve();

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('findLoginProvider', () => {
    const globalProvider = {
      id: OIDC_GLOBAL_PROVIDER_ID,
      name: 'Rauthy',
      issuer: 'https://idp.example.com/auth/v1',
      clientId: 'global-client',
      clientSecret: 'global-secret',
    } as const;

    it('binds the provider to the workspace of the login url', async () => {
      const { service, workspaceRepository } = buildService();

      await expect(
        service.findLoginProvider(globalProvider, WORKSPACE_ID),
      ).resolves.toEqual(
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
      const provider = await buildService().service.findLoginProvider(
        globalProvider,
        WORKSPACE_ID,
      );

      expect(JSON.stringify(provider)).not.toContain('global-secret');
    });

    it.each([undefined, 'not-a-uuid'])(
      'refuses a missing or malformed workspace id (%s)',
      async (workspaceId) => {
        const { service, workspaceRepository } = buildService();

        await expect(
          service.findLoginProvider(globalProvider, workspaceId),
        ).resolves.toBeNull();
        expect(workspaceRepository.findOne).not.toHaveBeenCalled();
      },
    );

    it('refuses an unknown workspace', async () => {
      const { service } = buildService({ workspace: null });

      await expect(
        service.findLoginProvider(globalProvider, WORKSPACE_ID),
      ).resolves.toBeNull();
    });
  });
});
