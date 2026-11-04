import { useLingui } from '@lingui/react/macro';
import { Fragment } from 'react';
import { useParams } from 'react-router-dom';
import { isDefined } from 'twenty-shared/utils';
import { MainButton } from 'twenty-ui/components/input';
import { IconLock } from 'twenty-ui/icon';
import { useTheme } from 'twenty-ui/theme';

import { SignInUpSeparator } from '@/auth/sign-in-up/components/internal/SignInUpSeparator';
import { StyledSsoButtonContainer } from '@/auth/sign-in-up/components/internal/SignInUpSsoButtonStyles';
import {
  SignInUpStep,
  signInUpStepState,
} from '@/auth/states/signInUpStepState';
import { useRedirect } from '@/domain-manager/hooks/useRedirect';
import { useOidcPublicProviders } from '@/oidc-sso/hooks/useOidcPublicProviders';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

export const SignInUpWithOidc = () => {
  const theme = useTheme();
  const { t } = useLingui();
  const providers = useOidcPublicProviders();
  const signInUpStep = useAtomStateValue(signInUpStepState);
  const workspaceInviteHash = useParams().workspaceInviteHash;
  const { redirect } = useRedirect();

  const signIn = (loginUrl: string) => {
    const url = new URL(loginUrl);

    if (isDefined(workspaceInviteHash)) {
      url.searchParams.set('workspaceInviteHash', workspaceInviteHash);
    }

    redirect(url.toString());
  };

  return (
    <>
      {providers.map(({ id, name, loginUrl }) => (
        <Fragment key={id}>
          <StyledSsoButtonContainer>
            <MainButton
              startIcon={<IconLock size={theme.icon.size.md} />}
              onClick={() => signIn(loginUrl)}
              fullWidth
              variant={signInUpStep === SignInUpStep.Init ? 'solid' : 'outline'}
            >{t`Sign in with ${name}`}</MainButton>
          </StyledSsoButtonContainer>
          <SignInUpSeparator />
        </Fragment>
      ))}
    </>
  );
};
