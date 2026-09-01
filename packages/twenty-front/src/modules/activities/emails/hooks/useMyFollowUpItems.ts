import { CLEAR_FOLLOW_UP_REMINDER } from '@/activities/emails/graphql/mutations/clearFollowUpReminder';
import { CLEAR_FOLLOW_UP_REMINDERS } from '@/activities/emails/graphql/mutations/clearFollowUpReminders';
import { SET_FOLLOW_UP_REMINDER } from '@/activities/emails/graphql/mutations/setFollowUpReminder';
import { SNOOZE_FOLLOW_UP_REMINDER } from '@/activities/emails/graphql/mutations/snoozeFollowUpReminder';
import { SNOOZE_FOLLOW_UP_REMINDERS } from '@/activities/emails/graphql/mutations/snoozeFollowUpReminders';
import { UPDATE_FOLLOW_UP_SETTINGS } from '@/activities/emails/graphql/mutations/updateFollowUpSettings';
import { GET_MY_AWAITING_REPLY_ITEMS } from '@/activities/emails/graphql/queries/getMyAwaitingReplyItems';
import { GET_MY_FOLLOW_UP_ITEMS } from '@/activities/emails/graphql/queries/getMyFollowUpItems';
import { GET_MY_FOLLOW_UP_SETTINGS } from '@/activities/emails/graphql/queries/getMyFollowUpSettings';
import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { type FollowUpItem } from '~/types/FollowUpItem';

export type FollowUpSettings = {
  thresholdDays: number;
  nudgeEnabled: boolean;
  nudgeIntervalDays: number;
  digestEnabled: boolean;
};

export const useMyFollowUpItems = () => {
  const apolloClient = useApolloClient();

  const { data, loading, refetch } = useQuery<{
    myFollowUpItems: FollowUpItem[];
  }>(GET_MY_FOLLOW_UP_ITEMS, {
    client: apolloClient,
  });

  const { data: awaitingReplyData, refetch: refetchAwaitingReply } = useQuery<{
    myAwaitingReplyItems: FollowUpItem[];
  }>(GET_MY_AWAITING_REPLY_ITEMS, {
    client: apolloClient,
  });

  const { data: settingsData, refetch: refetchSettings } = useQuery<{
    myFollowUpSettings: FollowUpSettings;
  }>(GET_MY_FOLLOW_UP_SETTINGS, {
    client: apolloClient,
  });

  const [setFollowUpReminderMutation] = useMutation<{
    setFollowUpReminder: boolean;
  }>(SET_FOLLOW_UP_REMINDER, { client: apolloClient });
  const [snoozeFollowUpReminderMutation] = useMutation<{
    snoozeFollowUpReminder: boolean;
  }>(SNOOZE_FOLLOW_UP_REMINDER, { client: apolloClient });
  const [clearFollowUpReminderMutation] = useMutation<{
    clearFollowUpReminder: boolean;
  }>(CLEAR_FOLLOW_UP_REMINDER, { client: apolloClient });
  const [snoozeFollowUpRemindersMutation] = useMutation<{
    snoozeFollowUpReminders: boolean;
  }>(SNOOZE_FOLLOW_UP_REMINDERS, { client: apolloClient });
  const [clearFollowUpRemindersMutation] = useMutation<{
    clearFollowUpReminders: boolean;
  }>(CLEAR_FOLLOW_UP_REMINDERS, { client: apolloClient });
  const [updateFollowUpSettingsMutation] = useMutation<{
    updateFollowUpSettings: FollowUpSettings;
  }>(UPDATE_FOLLOW_UP_SETTINGS, { client: apolloClient });

  const setFollowUpReminder = async (
    messageThreadId: string,
    followUpAt: Date,
  ) => {
    await setFollowUpReminderMutation({
      variables: {
        messageThreadId,
        followUpAt: followUpAt.toISOString(),
      },
    });
    await refetch();
  };

  const snoozeFollowUpReminder = async (
    messageThreadId: string,
    days: number,
  ) => {
    await snoozeFollowUpReminderMutation({
      variables: { messageThreadId, days },
    });
    await refetch();
  };

  const clearFollowUpReminder = async (messageThreadId: string) => {
    await clearFollowUpReminderMutation({
      variables: { messageThreadId },
    });
    await refetch();
  };

  const snoozeFollowUpReminders = async (
    messageThreadIds: string[],
    days: number,
  ) => {
    await snoozeFollowUpRemindersMutation({
      variables: { messageThreadIds, days },
    });
    await refetch();
  };

  const clearFollowUpReminders = async (messageThreadIds: string[]) => {
    await clearFollowUpRemindersMutation({
      variables: { messageThreadIds },
    });
    await refetch();
  };

  const updateFollowUpSettings = async (input: Partial<FollowUpSettings>) => {
    const result = await updateFollowUpSettingsMutation({
      variables: {
        thresholdDays: input.thresholdDays ?? null,
        nudgeEnabled: input.nudgeEnabled ?? null,
        nudgeIntervalDays: input.nudgeIntervalDays ?? null,
        digestEnabled: input.digestEnabled ?? null,
      },
    });

    await Promise.all([refetch(), refetchSettings()]);

    return result.data?.updateFollowUpSettings ?? null;
  };

  return {
    followUpItems: data?.myFollowUpItems ?? [],
    awaitingReplyItems: awaitingReplyData?.myAwaitingReplyItems ?? [],
    loading,
    refetch,
    refetchAwaitingReply,
    settings: settingsData?.myFollowUpSettings ?? null,
    setFollowUpReminder,
    snoozeFollowUpReminder,
    clearFollowUpReminder,
    snoozeFollowUpReminders,
    clearFollowUpReminders,
    updateFollowUpSettings,
  };
};
