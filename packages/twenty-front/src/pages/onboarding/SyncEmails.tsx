import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { clientConfigApiStatusState } from '@/client-config/states/clientConfigApiStatusState';
import { isImapSmtpCaldavEnabledState } from '@/client-config/states/isImapSmtpCaldavEnabledState';
import { onboardingConfigState } from '@/client-config/states/onboardingConfigState';
import { SyncEmailsAutoSkipEffect } from '@/onboarding/effect-components/SyncEmailsAutoSkipEffect';
import { useSkipSyncEmailOnboardingStep } from '@/onboarding/hooks/useSkipSyncEmailOnboardingStep';
import { onboardingFreeCreditsState } from '@/onboarding/states/onboardingFreeCreditsState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { useCallback, useState } from 'react';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { ImportContacts } from '~/pages/onboarding/ImportContacts';
import { useNavigate } from 'react-router-dom';

export const SyncEmails = () => {
  const navigate = useNavigate();
  const skipSyncEmailOnboardingStep = useSkipSyncEmailOnboardingStep();
  const setOnboardingFreeCredits = useSetAtomState(onboardingFreeCreditsState);
  const [hasAutoSkipFailed, setHasAutoSkipFailed] = useState(false);

  const isClientConfigLoaded = useAtomStateValue(
    clientConfigApiStatusState,
  ).isLoadedOnce;
  const isImapSmtpCaldavEnabled = useAtomStateValue(
    isImapSmtpCaldavEnabledState,
  );
  const onboardingConfig = useAtomStateValue(onboardingConfigState);
  const currentWorkspace = useAtomStateValue(currentWorkspaceState);

  const creditsReward =
    currentWorkspace?.workspaceMembersCount === 1
      ? onboardingConfig?.importContactsCreditsReward
      : undefined;

  const handleSkip = async () => {
    await skipSyncEmailOnboardingStep({ isAutoSkipped: false });

    setOnboardingFreeCredits((current) => ({
      ...current,
      importContacts: 0,
    }));
  };

  const handleAutoSkipError = useCallback(() => {
    setHasAutoSkipFailed(true);
  }, []);

  if (!isClientConfigLoaded) {
    return null;
  }

  if (!isImapSmtpCaldavEnabled && !hasAutoSkipFailed) {
    return <SyncEmailsAutoSkipEffect onError={handleAutoSkipError} />;
  }

  return (
    <ImportContacts
      creditsReward={creditsReward}
      onContinueWithImap={
        isImapSmtpCaldavEnabled
          ? () =>
              navigate(
                getSettingsPath(SettingsPath.NewImapSmtpCaldavConnection),
              )
          : undefined
      }
      onSkip={handleSkip}
    />
  );
};
