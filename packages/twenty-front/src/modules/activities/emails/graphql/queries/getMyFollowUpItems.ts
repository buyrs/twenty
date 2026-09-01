import { gql } from '@apollo/client';

export const GET_MY_FOLLOW_UP_ITEMS = gql`
  query MyFollowUpItems {
    myFollowUpItems {
      messageThreadId
      subject
      contactEmail
      contactName
      personId
      connectedAccountId
      messageChannelId
      lastOutboundMessageId
      lastOutboundMessageText
      lastOutboundMessageReceivedAt
      followUpAt
      snoozedUntil
      daysWaiting
    }
  }
`;
