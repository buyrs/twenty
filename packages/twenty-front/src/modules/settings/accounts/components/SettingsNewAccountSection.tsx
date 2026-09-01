import { SettingsAccountsListEmptyStateCard } from '@/settings/accounts/components/SettingsAccountsListEmptyStateCard';
import { t } from '@lingui/core/macro';
import { H2Title } from 'twenty-ui/typography';
import { Section } from 'twenty-ui/layout';

export const SettingsNewAccountSection = () => {
  return (
    <Section>
      <H2Title
        title={t`New account`}
        description={t`Connect a custom email account using IMAP for receiving and SMTP for sending`}
      />
      <SettingsAccountsListEmptyStateCard />
    </Section>
  );
};
