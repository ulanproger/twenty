import { CreateWorkspaceOidcProviderFastInstanceCommand } from 'src/engine/core-modules/oidc-sso/migrations/1793873141282-create-workspace-oidc-provider.fast-instance-command';
import { getRegisteredInstanceCommandMetadata } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';

describe('CreateWorkspaceOidcProviderFastInstanceCommand', () => {
  it('is registered as a fast command of version 2.56.0 after every upstream command of that version', () => {
    // Maximum timestamp in upgrade-version-command/2-56 when this command was written
    const LAST_UPSTREAM_TIMESTAMP_IN_2_56 = 1793873141281;

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
