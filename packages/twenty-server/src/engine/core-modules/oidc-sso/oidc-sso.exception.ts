import { type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { assertUnreachable } from 'twenty-shared/utils';

import { CustomException } from 'src/utils/custom-exception';

export type OidcSsoExceptionCode =
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_ALREADY_EXISTS'
  | 'INVALID_ISSUER'
  | 'ISSUER_DISCOVERY_FAILED';

const getUserFriendlyMessage = (
  code: OidcSsoExceptionCode,
): MessageDescriptor => {
  switch (code) {
    case 'PROVIDER_NOT_FOUND':
      return msg`Identity provider not found.`;
    case 'PROVIDER_ALREADY_EXISTS':
      return msg`This identity provider is already configured.`;
    case 'INVALID_ISSUER':
      return msg`Invalid issuer URL.`;
    case 'ISSUER_DISCOVERY_FAILED':
      return msg`Could not load the OpenID configuration from the issuer.`;
    default:
      return assertUnreachable(code);
  }
};

export class OidcSsoException extends CustomException<OidcSsoExceptionCode> {
  constructor(message: string, code: OidcSsoExceptionCode) {
    super(message, code, { userFriendlyMessage: getUserFriendlyMessage(code) });
  }
}
