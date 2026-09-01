import { gql } from '@apollo/client';

export const SNOOZE_FOLLOW_UP_REMINDERS = gql`
  mutation SnoozeFollowUpReminders(
    $messageThreadIds: [String!]!
    $days: Float!
  ) {
    snoozeFollowUpReminders(messageThreadIds: $messageThreadIds, days: $days)
  }
`;
