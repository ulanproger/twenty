import { CreateWorkspaceOidcProviderFastInstanceCommand } from 'src/engine/core-modules/oidc-sso/migrations/1793931091088-create-workspace-oidc-provider.fast-instance-command';
import { getRegisteredInstanceCommandMetadata } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';

describe('CreateWorkspaceOidcProviderFastInstanceCommand', () => {
  it('is registered as a fast command of version 2.56.0 after every upstream command of that version', () => {
    const LAST_UPSTREAM_TIMESTAMP_IN_2_56 = 1793816136545;

    const metadata = getRegisteredInstanceCommandMetadata(
      CreateWorkspaceOidcProviderFastInstanceCommand,
    );

    expect(metadata?.version).toBe('2.56.0');
    expect(metadata?.type).toBe('fast');
    expect(metadata?.timestamp).toBeGreaterThan(
      LAST_UPSTREAM_TIMESTAMP_IN_2_56,
    );
  });
});
