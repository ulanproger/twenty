import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

// Version is pinned on purpose: the command name includes it, so following
// TWENTY_CURRENT_VERSION would re-run the command after every upstream bump.
@RegisteredInstanceCommand('2.51.0', 1793640971352)
export class CreateWorkspaceOidcProviderFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "core"."workspaceOidcProvider" (
        "workspaceId" uuid NOT NULL,
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "issuer" character varying NOT NULL,
        "clientId" character varying NOT NULL,
        "clientSecret" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'active',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "IDX_workspaceOidcProvider_workspaceId_issuer_clientId_UNIQUE" UNIQUE ("workspaceId", "issuer", "clientId"),
        CONSTRAINT "CHK_workspaceOidcProvider_status" CHECK ("status" IN ('active', 'inactive')),
        CONSTRAINT "CHK_workspaceOidcProvider_clientSecret_encrypted" CHECK ("clientSecret" LIKE 'enc:v2:%'),
        CONSTRAINT "PK_ed966c9ab3447c7628882c699c2" PRIMARY KEY ("id"),
        CONSTRAINT "FK_b5db159dc90e0f92cbb65bfde55" FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "core"."workspaceOidcProvider"`,
    );
  }
}
