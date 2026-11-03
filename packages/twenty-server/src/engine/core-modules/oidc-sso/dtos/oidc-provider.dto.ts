import { Field, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

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
  status: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}
