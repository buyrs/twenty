import { gql } from '@apollo/client';

export const CLEAR_FOLLOW_UP_REMINDERS = gql`
  mutation ClearFollowUpReminders($messageThreadIds: [String!]!) {
    clearFollowUpReminders(messageThreadIds: $messageThreadIds)
  }
`;
