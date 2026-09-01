import { gql } from '@apollo/client';

export const CLEAR_FOLLOW_UP_REMINDER = gql`
  mutation ClearFollowUpReminder($messageThreadId: String!) {
    clearFollowUpReminder(messageThreadId: $messageThreadId)
  }
`;
