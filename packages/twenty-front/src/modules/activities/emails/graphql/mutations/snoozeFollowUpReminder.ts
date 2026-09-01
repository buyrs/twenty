import { gql } from '@apollo/client';

export const SNOOZE_FOLLOW_UP_REMINDER = gql`
  mutation SnoozeFollowUpReminder($messageThreadId: String!, $days: Float!) {
    snoozeFollowUpReminder(messageThreadId: $messageThreadId, days: $days)
  }
`;
