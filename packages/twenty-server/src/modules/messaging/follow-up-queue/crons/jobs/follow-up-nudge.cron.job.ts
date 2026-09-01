import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FollowUpQueueService } from 'src/modules/messaging/follow-up-queue/services/follow-up-queue.service';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

export const FOLLOW_UP_NUDGE_CRON_PATTERN = '0 * * * *';

@Processor(MessageQueue.cronQueue)
export class FollowUpNudgeCronJob {
  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly followUpQueueService: FollowUpQueueService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
  ) {}

  @Process(FollowUpNudgeCronJob.name)
  @SentryCronMonitor(FollowUpNudgeCronJob.name, FOLLOW_UP_NUDGE_CRON_PATTERN)
  async handle(): Promise<void> {
    const activeWorkspaces = await this.workspaceRepository.find({
      where: {
        activationStatus: WorkspaceActivationStatus.ACTIVE,
      },
    });

    for (const activeWorkspace of activeWorkspaces) {
      try {
        await this.followUpQueueService.sendDueNudges(activeWorkspace.id);
      } catch (error) {
        this.exceptionHandlerService.captureExceptions([error], {
          workspace: {
            id: activeWorkspace.id,
          },
        });
      }
    }
  }
}
