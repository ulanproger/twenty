import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { type EncryptedString } from 'src/engine/core-modules/secret-encryption/branded-strings/encrypted-string.type';
import { WorkspaceRelatedEntity } from 'src/engine/workspace-manager/types/workspace-related-entity.type';

@Entity({ name: 'workspaceOidcProvider', schema: 'core' })
@Unique('IDX_workspaceOidcProvider_workspaceId_issuer_clientId_UNIQUE', [
  'workspaceId',
  'issuer',
  'clientId',
])
@Check('CHK_workspaceOidcProvider_status', `"status" IN ('active', 'inactive')`)
@Check(
  'CHK_workspaceOidcProvider_clientSecret_encrypted',
  `"clientSecret" LIKE 'enc:v2:%'`,
)
export class WorkspaceOidcProviderEntity extends WorkspaceRelatedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  issuer: string;

  @Column({ type: 'varchar' })
  clientId: string;

  @Column({ type: 'varchar' })
  clientSecret: EncryptedString;

  @Column({ type: 'varchar', default: 'active' })
  status: 'active' | 'inactive';

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
