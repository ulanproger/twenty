import { Catch, type ExceptionFilter } from '@nestjs/common';

import { assertUnreachable } from 'twenty-shared/utils';

import {
  ConflictError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { OidcSsoException } from 'src/engine/core-modules/oidc-sso/oidc-sso.exception';

@Catch(OidcSsoException)
export class OidcSsoGraphqlApiExceptionFilter implements ExceptionFilter {
  catch(exception: OidcSsoException) {
    switch (exception.code) {
      case 'PROVIDER_NOT_FOUND':
        throw new NotFoundError(exception);
      case 'PROVIDER_ALREADY_EXISTS':
        throw new ConflictError(exception);
      case 'INVALID_ISSUER':
      case 'ISSUER_DISCOVERY_FAILED':
        throw new UserInputError(exception);
      default:
        return assertUnreachable(exception.code);
    }
  }
}
