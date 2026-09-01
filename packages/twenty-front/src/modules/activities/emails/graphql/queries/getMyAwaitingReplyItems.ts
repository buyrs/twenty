import { gql } from '@apollo/client';

export const GET_MY_AWAITING_REPLY_ITEMS = gql`
  query MyAwaitingReplyItems {
    myAwaitingReplyItems {
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
