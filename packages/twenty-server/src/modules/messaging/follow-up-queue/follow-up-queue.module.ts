import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DomainServerConfigModule } from 'src/engine/core-modules/domain/domain-server-config/domain-server-config.module';
import { KeyValuePairModule } from 'src/engine/core-modules/key-value-pair/key-value-pair.module';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { ToolModule } from 'src/engine/core-modules/tool/tool.module';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { FollowUpDigestCronCommand } from 'src/modules/messaging/follow-up-queue/crons/commands/follow-up-digest.cron.command';
import { FollowUpNudgeCronCommand } from 'src/modules/messaging/follow-up-queue/crons/commands/follow-up-nudge.cron.command';
import { FollowUpDigestCronJob } from 'src/modules/messaging/follow-up-queue/crons/jobs/follow-up-digest.cron.job';
import { FollowUpNudgeCronJob } from 'src/modules/messaging/follow-up-queue/crons/jobs/follow-up-nudge.cron.job';
import { FollowUpQueueResolver } from 'src/modules/messaging/follow-up-queue/resolvers/follow-up-queue.resolver';
import { FollowUpQueueService } from 'src/modules/messaging/follow-up-queue/services/follow-up-queue.service';
import { MessagingSendManagerModule } from 'src/modules/messaging/message-outbound-manager/messaging-send-manager.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MessageChannelEntity,
      KeyValuePairEntity,
      UserWorkspaceEntity,
      WorkspaceEntity,
    ]),
    KeyValuePairModule,
    ToolModule,
    MessagingSendManagerModule,
    DomainServerConfigModule,
  ],
  providers: [
    FollowUpQueueService,
    FollowUpQueueResolver,
    FollowUpNudgeCronJob,
    FollowUpNudgeCronCommand,
    FollowUpDigestCronJob,
    FollowUpDigestCronCommand,
  ],
  exports: [
    FollowUpQueueService,
    FollowUpNudgeCronCommand,
    FollowUpDigestCronCommand,
  ],
})
export class FollowUpQueueModule {}
