import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('FollowUpItem')
export class FollowUpItemDTO {
  @Field()
  messageThreadId: string;

  @Field(() => String, { nullable: true })
  subject: string | null;

  @Field()
  contactEmail: string;

  @Field(() => String, { nullable: true })
  contactName: string | null;

  @Field(() => String, { nullable: true })
  personId: string | null;

  @Field()
  connectedAccountId: string;

  @Field()
  messageChannelId: string;

  @Field()
  lastOutboundMessageId: string;

  @Field(() => String, { nullable: true })
  lastOutboundMessageText: string | null;

  @Field()
  lastOutboundMessageReceivedAt: Date;

  @Field(() => Date, { nullable: true })
  followUpAt: Date | null;

  @Field(() => Date, { nullable: true })
  snoozedUntil: Date | null;

  @Field()
  daysWaiting: number;
}
