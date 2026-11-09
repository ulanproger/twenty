import { Field, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { type WorkspaceOidcProviderEntity } from 'src/engine/core-modules/oidc-sso/entities/workspace-oidc-provider.entity';

@ObjectType('OidcProvider')
export class OidcProviderDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  issuer: string;

  @Field(() => String)
  clientId: string;

  @Field(() => String)
  status: WorkspaceOidcProviderEntity['status'];

  @Field(() => Boolean)
  isGlobal: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}
