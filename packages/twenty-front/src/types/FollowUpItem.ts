export type FollowUpItem = {
  messageThreadId: string;
  subject: string | null;
  contactEmail: string;
  contactName: string | null;
  personId: string | null;
  connectedAccountId: string;
  messageChannelId: string;
  lastOutboundMessageId: string;
  lastOutboundMessageText: string | null;
  lastOutboundMessageReceivedAt: string;
  followUpAt: string | null;
  snoozedUntil: string | null;
  daysWaiting: number;
};
