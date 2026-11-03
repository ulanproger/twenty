import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType('CreateOidcProviderInput')
export class CreateOidcProviderInput {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  issuer: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  clientId: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  clientSecret: string;
}
