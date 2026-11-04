import { useLingui } from '@lingui/react/macro';
import { Fragment } from 'react';
import { useParams } from 'react-router-dom';
import { isDefined } from 'twenty-shared/utils';
import { MainButton } from 'twenty-ui/components/input';
import { IconLock } from 'twenty-ui/icon';
import { Separator } from 'twenty-ui/primitives/layout';
import { useTheme } from 'twenty-ui/theme';

import { SignInUpSeparator } from '@/auth/sign-in-up/components/internal/SignInUpSeparator';
import { StyledSsoButtonContainer } from '@/auth/sign-in-up/components/internal/SignInUpSsoButtonStyles';
import {
  SignInUpStep,
  signInUpStepState,
} from '@/auth/states/signInUpStepState';
import { workspaceAuthProvidersState } from '@/workspace/states/workspaceAuthProvidersState';
import { useRedirect } from '@/domain-manager/hooks/useRedirect';
import { useOidcPublicProviders } from '@/oidc-sso/hooks/useOidcPublicProviders';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

export const SignInUpWithOidc = () => {
  const theme = useTheme();
  const { t } = useLingui();
  const providers = useOidcPublicProviders();
  const signInUpStep = useAtomStateValue(signInUpStepState);
  const workspaceAuthProviders = useAtomStateValue(workspaceAuthProvidersState);
  const workspaceInviteHash = useParams().workspaceInviteHash;
  const { redirect } = useRedirect();

  const signIn = (loginUrl: string) => {
    const url = new URL(loginUrl);

    if (isDefined(workspaceInviteHash)) {
      url.searchParams.set('workspaceInviteHash', workspaceInviteHash);
    }

    redirect(url.toString());
  };

  // The form draws this line itself when Google, Microsoft or SSO precede the password form.
  const needsDivider =
    providers.length > 0 &&
    workspaceAuthProviders?.password === true &&
    !workspaceAuthProviders.google &&
    !workspaceAuthProviders.microsoft &&
    workspaceAuthProviders.sso.length === 0;

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
      {needsDivider && (
        <>
          <Separator />
          <SignInUpSeparator />
        </>
      )}
    </>
  );
};
