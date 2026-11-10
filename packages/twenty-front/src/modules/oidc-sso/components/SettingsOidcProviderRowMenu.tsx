import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useMutation } from '@apollo/client/react';
import { useToast } from 'twenty-ui/components/feedback';
import { LightIconButton } from 'twenty-ui/components/input';
import { Dropdown } from 'twenty-ui/components/navigation';
import { IconArchive, IconDotsVertical, IconTrash } from 'twenty-ui/icon';
import { Status } from 'twenty-ui/primitives/data-display';
import { themeCssVariables } from 'twenty-ui/theme';

import { getToastOptionsFromError } from '@/error-handler/utils/getToastOptionsFromError';
import {
  DELETE_OIDC_PROVIDER,
  UPDATE_OIDC_PROVIDER,
} from '@/oidc-sso/graphql/mutations';
import { OIDC_PROVIDERS } from '@/oidc-sso/graphql/queries';
import { type OidcProvider } from '@/oidc-sso/types/OidcProvider';
import { ConfirmationDialog } from '@/ui/layout/dialog/components/ConfirmationDialog';
import { useDialog } from '@/ui/layout/dialog/hooks/useDialog';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownRoot } from '@/ui/layout/dropdown/components/DropdownRoot';

const StyledRowRight = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
`;

type SettingsOidcProviderRowMenuProps = {
  item: OidcProvider;
};

export const SettingsOidcProviderRowMenu = ({
  item: provider,
}: SettingsOidcProviderRowMenuProps) => {
  const { t } = useLingui();
  const { enqueueToast } = useToast();
  const { openDialog } = useDialog();
  const deleteDialogId = `oidc-provider-delete-${provider.id}`;
  const isActive = provider.status === 'active';

  const mutationOptions = { refetchQueries: [{ query: OIDC_PROVIDERS }] };
  const [updateProvider] = useMutation(UPDATE_OIDC_PROVIDER, mutationOptions);
  const [deleteProvider] = useMutation(DELETE_OIDC_PROVIDER, mutationOptions);

  const toggleStatus = async () => {
    try {
      await updateProvider({
        variables: {
          input: {
            id: provider.id,
            status: isActive ? 'inactive' : 'active',
          },
        },
      });
    } catch (error) {
      enqueueToast(getToastOptionsFromError({ error }));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteProvider({ variables: { input: { id: provider.id } } });
    } catch (error) {
      enqueueToast(getToastOptionsFromError({ error }));
    }
  };

  return (
    <StyledRowRight>
      <Status color={isActive ? 'green' : 'gray'} weight="medium">
        {isActive ? t`Active` : t`Inactive`}
      </Status>
      {!provider.isGlobal && (
        <>
          <DropdownRoot
            type="menu"
            dropdownId={`oidc-provider-row-${provider.id}`}
          >
            <Dropdown.Trigger
              render={
                <LightIconButton emphasis="subtle" aria-label={t`More options`}>
                  <IconDotsVertical />
                </LightIconButton>
              }
            />
            <DropdownContent side="right" align="start">
              <Dropdown.Section>
                <Dropdown.ActionItem
                  startIcon={<IconArchive />}
                  onClick={toggleStatus}
                >
                  {isActive ? t`Deactivate` : t`Activate`}
                </Dropdown.ActionItem>
                <Dropdown.ActionItem
                  color="danger"
                  startIcon={<IconTrash />}
                  onClick={() => openDialog(deleteDialogId)}
                >{t`Delete`}</Dropdown.ActionItem>
              </Dropdown.Section>
            </DropdownContent>
          </DropdownRoot>
          <ConfirmationDialog
            dialogId={deleteDialogId}
            title={t`Delete OIDC provider`}
            subtitle={t`Users will no longer be able to sign in through ${provider.name}.`}
            onConfirmClick={handleDelete}
            confirmButtonText={t`Delete`}
          />
        </>
      )}
    </StyledRowRight>
  );
};
