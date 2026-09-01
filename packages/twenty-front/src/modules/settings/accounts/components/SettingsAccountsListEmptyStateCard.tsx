import { isImapSmtpCaldavEnabledState } from '@/client-config/states/isImapSmtpCaldavEnabledState';
import { SettingsCard } from '@/settings/components/SettingsCard';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useContext } from 'react';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { IconAt } from 'twenty-ui/icon';
import { UndecoratedLink } from 'twenty-ui/navigation';
import { ThemeContext, themeCssVariables } from 'twenty-ui/theme-constants';

const StyledCardsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

export const SettingsAccountsListEmptyStateCard = () => {
  const { theme } = useContext(ThemeContext);
  const { t } = useLingui();

  const isImapSmtpCaldavEnabled = useAtomStateValue(
    isImapSmtpCaldavEnabledState,
  );

  return (
    <StyledCardsContainer>
      {isImapSmtpCaldavEnabled && (
        <UndecoratedLink
          to={getSettingsPath(SettingsPath.NewImapSmtpCaldavConnection)}
        >
          <SettingsCard
            Icon={<IconAt size={theme.icon.size.md} />}
            title={t`Connect via IMAP/SMTP`}
          />
        </UndecoratedLink>
      )}
    </StyledCardsContainer>
  );
};
