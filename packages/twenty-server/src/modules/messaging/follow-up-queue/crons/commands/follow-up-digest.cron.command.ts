import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  FOLLOW_UP_DIGEST_CRON_PATTERN,
  FollowUpDigestCronJob,
} from 'src/modules/messaging/follow-up-queue/crons/jobs/follow-up-digest.cron.job';

@Command({
  name: 'cron:messaging:follow-up-digest',
  description:
    'Starts a cron job to send daily digest emails for due follow-ups and awaiting-reply items',
})
export class FollowUpDigestCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: FollowUpDigestCronJob.name,
      data: undefined,
      options: {
        repeat: { pattern: FOLLOW_UP_DIGEST_CRON_PATTERN },
      },
    });
  }
}
