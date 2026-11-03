import { OidcAccountService } from 'src/engine/core-modules/oidc-sso/services/oidc-account.service';
import { type AuthService } from 'src/engine/core-modules/auth/services/auth.service';
import { type LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { type UserService } from 'src/engine/core-modules/user/services/user.service';

const identity = {
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: null,
};

const activeProvider = {
  workspaceId: 'workspace-a',
  status: 'active',
} as const;

const buildService = ({
  resolvedWorkspaceId = 'workspace-a',
  user = { id: 'user-1', email: 'ada@example.com', isEmailVerified: false },
}: {
  resolvedWorkspaceId?: string | null;
  user?: Record<string, unknown>;
} = {}) => {
  const authService = {
    findWorkspaceForSignInUp: jest
      .fn()
      .mockResolvedValue(
        resolvedWorkspaceId === null ? undefined : { id: resolvedWorkspaceId },
      ),
    findInvitationForSignInUp: jest.fn().mockResolvedValue(undefined),
    formatUserDataPayload: jest
      .fn()
      .mockReturnValue({ userData: { type: 'newUser' } }),
    checkAccessForSignIn: jest.fn().mockResolvedValue(undefined),
    signInUp: jest.fn().mockImplementation(async () => ({
      user,
      workspace: { id: resolvedWorkspaceId },
    })),
    createSsoConnectedAccountIfFeatureFlagIsOn: jest
      .fn()
      .mockResolvedValue(undefined),
    computeRedirectURI: jest
      .fn()
      .mockReturnValue('https://acme.example.com/verify'),
  };
  const userService = {
    findUserByEmail: jest.fn().mockResolvedValue(null),
    markEmailAsVerified: jest.fn().mockResolvedValue(undefined),
  };
  const loginTokenService = {
    generateLoginToken: jest.fn().mockResolvedValue({ token: 'login-token' }),
  };

  return {
    authService,
    userService,
    loginTokenService,
    service: new OidcAccountService(
      authService as unknown as AuthService,
      userService as unknown as UserService,
      loginTokenService as unknown as LoginTokenService,
    ),
  };
};

describe('OidcAccountService', () => {
  it('signs the user in and returns the verify URL', async () => {
    const { service, authService, loginTokenService } = buildService();

    await expect(
      service.signIn({
        provider: activeProvider,
        identity,
        claims: { sub: 'sub-1' },
        workspaceInviteHash: undefined,
      }),
    ).resolves.toBe('https://acme.example.com/verify');

    expect(authService.findWorkspaceForSignInUp).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      workspaceInviteHash: undefined,
      email: 'ada@example.com',
      authProvider: 'sso',
    });
    expect(authService.formatUserDataPayload).toHaveBeenCalledWith(
      { ...identity, isEmailAlreadyVerified: true },
      null,
    );
    expect(loginTokenService.generateLoginToken).toHaveBeenCalledWith(
      'ada@example.com',
      'workspace-a',
      'sso',
    );
    expect(authService.computeRedirectURI).toHaveBeenCalledWith({
      loginToken: 'login-token',
      workspace: { id: 'workspace-a' },
    });
  });

  it('stores the claims on the connected account', async () => {
    const { service, authService } = buildService();

    await service.signIn({
      provider: activeProvider,
      identity,
      claims: { sub: 'sub-1' },
      workspaceInviteHash: undefined,
    });

    expect(
      authService.createSsoConnectedAccountIfFeatureFlagIsOn,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      userId: 'user-1',
      handle: 'ada@example.com',
      authProvider: 'sso',
      oidcTokenClaims: { sub: 'sub-1' },
      connectedAccountProvider: 'oidc',
    });
  });

  it('marks the email verified for a user without a password', async () => {
    const { service, userService } = buildService({
      user: {
        id: 'user-1',
        email: 'ada@example.com',
        isEmailVerified: false,
        passwordHash: null,
      },
    });

    await service.signIn({
      provider: activeProvider,
      identity,
      claims: {},
      workspaceInviteHash: undefined,
    });

    expect(userService.markEmailAsVerified).toHaveBeenCalledWith('user-1');
  });

  it('leaves the email flag of a user who already has a password', async () => {
    const { service, userService } = buildService({
      user: {
        id: 'user-1',
        email: 'ada@example.com',
        isEmailVerified: false,
        passwordHash: 'hash',
      },
    });

    await service.signIn({
      provider: activeProvider,
      identity,
      claims: {},
      workspaceInviteHash: undefined,
    });

    expect(userService.markEmailAsVerified).not.toHaveBeenCalled();
  });

  it('refuses a provider of another workspace reached through an invite hash', async () => {
    const { service, authService } = buildService({
      resolvedWorkspaceId: 'workspace-b',
    });

    await expect(
      service.signIn({
        provider: activeProvider,
        identity,
        claims: {},
        workspaceInviteHash: 'hash-of-workspace-b',
      }),
    ).rejects.toThrow('OIDC provider access denied: workspace-mismatch');

    expect(authService.signInUp).not.toHaveBeenCalled();
  });

  it('refuses an inactive provider', async () => {
    const { service, authService } = buildService();

    await expect(
      service.signIn({
        provider: { workspaceId: 'workspace-a', status: 'inactive' },
        identity,
        claims: {},
        workspaceInviteHash: undefined,
      }),
    ).rejects.toThrow('OIDC provider access denied: provider-inactive');

    expect(authService.signInUp).not.toHaveBeenCalled();
  });

  it('fails when the workspace cannot be resolved', async () => {
    const { service, authService } = buildService({
      resolvedWorkspaceId: null,
    });

    await expect(
      service.signIn({
        provider: activeProvider,
        identity,
        claims: {},
        workspaceInviteHash: 'unknown-hash',
      }),
    ).rejects.toThrow('Workspace not found');

    expect(authService.signInUp).not.toHaveBeenCalled();
  });
});
