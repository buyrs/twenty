import { gql } from '@apollo/client';

export const SET_FOLLOW_UP_REMINDER = gql`
  mutation SetFollowUpReminder(
    $messageThreadId: String!
    $followUpAt: DateTime!
  ) {
    setFollowUpReminder(
      messageThreadId: $messageThreadId
      followUpAt: $followUpAt
    )
  }
`;
