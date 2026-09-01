import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  FOLLOW_UP_NUDGE_CRON_PATTERN,
  FollowUpNudgeCronJob,
} from 'src/modules/messaging/follow-up-queue/crons/jobs/follow-up-nudge.cron.job';

@Command({
  name: 'cron:messaging:follow-up-nudge',
  description:
    'Starts a cron job to send automatic nudge emails for threads past their follow-up threshold',
})
export class FollowUpNudgeCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: FollowUpNudgeCronJob.name,
      data: undefined,
      options: {
        repeat: { pattern: FOLLOW_UP_NUDGE_CRON_PATTERN },
      },
    });
  }
}
