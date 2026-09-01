import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('FollowUpSettings')
export class FollowUpSettingsDTO {
  @Field()
  thresholdDays: number;

  @Field()
  nudgeEnabled: boolean;

  @Field()
  nudgeIntervalDays: number;

  @Field()
  digestEnabled: boolean;
}
