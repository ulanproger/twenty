import { useMutation } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { useToast } from 'twenty-ui/components/feedback';
import { Button } from 'twenty-ui/primitives/input';
import { Dialog } from 'twenty-ui/primitives/surfaces';
import { themeCssVariables } from 'twenty-ui/theme';

import { getToastOptionsFromError } from '@/error-handler/utils/getToastOptionsFromError';
import { CREATE_OIDC_PROVIDER } from '@/oidc-sso/graphql/mutations';
import { OIDC_PROVIDERS } from '@/oidc-sso/graphql/queries';
import { useBuildServerUrl } from '@/settings/security/hooks/useBuildServerUrl';
import { SettingsTextInput } from '@/ui/input/components/SettingsTextInput';
import { DialogInstance } from '@/ui/layout/dialog/components/DialogInstance';
import { useDialog } from '@/ui/layout/dialog/hooks/useDialog';

type SettingsOidcProviderCreateDialogProps = {
  dialogId: string;
};

const CALLBACK_PATH = '/auth/oidc-sso/callback';

const StyledFields = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
`;

const StyledActionSlot = styled.div`
  flex: 1;
`;

const EMPTY_FORM = { name: '', issuer: '', clientId: '', clientSecret: '' };

export const SettingsOidcProviderCreateDialog = ({
  dialogId,
}: SettingsOidcProviderCreateDialogProps) => {
  const { t } = useLingui();
  const { closeDialog } = useDialog();
  const { enqueueToast } = useToast();
  const buildServerUrl = useBuildServerUrl();
  const redirectUri = buildServerUrl(CALLBACK_PATH);
  const [form, setForm] = useState(EMPTY_FORM);

  const [createProvider, { loading }] = useMutation(CREATE_OIDC_PROVIDER, {
    refetchQueries: [{ query: OIDC_PROVIDERS }],
  });

  const isValid = Object.values(form).every((value) => value.trim() !== '');

  const handleClose = () => {
    setForm(EMPTY_FORM);
    closeDialog(dialogId);
  };

  const handleSubmit = async () => {
    try {
      await createProvider({
        variables: {
          input: Object.fromEntries(
            Object.entries(form).map(([key, value]) => [key, value.trim()]),
          ),
        },
      });
      handleClose();
    } catch (error) {
      enqueueToast(getToastOptionsFromError({ error }));
    }
  };

  const renderField = (
    key: keyof typeof EMPTY_FORM,
    label: string,
    type?: 'password',
  ) => (
    <SettingsTextInput
      instanceId={`${dialogId}-${key}`}
      label={label}
      type={type}
      value={form[key]}
      onChange={(value) =>
        setForm((previous) => ({ ...previous, [key]: value }))
      }
      fullWidth
    />
  );

  return (
    <DialogInstance
      dialogId={dialogId}
      dismissible
      onClose={handleClose}
      renderInDocumentBody
    >
      {({ onKeyDown }) => (
        <Dialog.Popup
          onKeyDown={onKeyDown}
          size="compact"
          data-globally-prevent-click-outside
        >
          <Dialog.Header>
            <Dialog.Title>{t`Add OIDC provider`}</Dialog.Title>
            <Dialog.Description>
              {t`Register this redirect URI in your identity provider: ${redirectUri}`}
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            <StyledFields>
              {renderField('name', t`Name`)}
              {renderField('issuer', t`Issuer URL`)}
              {renderField('clientId', t`Client ID`)}
              {renderField('clientSecret', t`Client secret`, 'password')}
            </StyledFields>
          </Dialog.Body>
          <Dialog.Footer>
            <StyledActionSlot>
              <Button
                onClick={handleClose}
                fullWidth
                variant="outline"
              >{t`Cancel`}</Button>
            </StyledActionSlot>
            <StyledActionSlot>
              <Button
                onClick={handleSubmit}
                fullWidth
                disabled={!isValid || loading}
                variant="solid"
                color="accent"
              >{t`Add`}</Button>
            </StyledActionSlot>
          </Dialog.Footer>
        </Dialog.Popup>
      )}
    </DialogInstance>
  );
};
