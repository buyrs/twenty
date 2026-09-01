import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUser } from 'src/engine/decorators/auth/auth-user.decorator';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { FollowUpItemDTO } from 'src/modules/messaging/follow-up-queue/dtos/follow-up-item.dto';
import { FollowUpSettingsDTO } from 'src/modules/messaging/follow-up-queue/dtos/follow-up-settings.dto';
import { FollowUpQueueService } from 'src/modules/messaging/follow-up-queue/services/follow-up-queue.service';

@MetadataResolver()
@UsePipes(ResolverValidationPipe)
@UseFilters(AuthGraphqlApiExceptionFilter)
@UseGuards(WorkspaceAuthGuard)
export class FollowUpQueueResolver {
  constructor(private readonly followUpQueueService: FollowUpQueueService) {}

  @Query(() => [FollowUpItemDTO])
  @UseGuards(NoPermissionGuard)
  async myFollowUpItems(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() { id: userId }: AuthContextUser,
  ): Promise<FollowUpItemDTO[]> {
    return this.followUpQueueService.getFollowUpItems(
      workspace.id,
      userWorkspaceId,
      userId,
    );
  }

  @Query(() => [FollowUpItemDTO])
  @UseGuards(NoPermissionGuard)
  async myAwaitingReplyItems(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<FollowUpItemDTO[]> {
    return this.followUpQueueService.getAwaitingReplyItems(
      workspace.id,
      userWorkspaceId,
    );
  }

  @Query(() => FollowUpSettingsDTO)
  @UseGuards(NoPermissionGuard)
  async myFollowUpSettings(
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<FollowUpSettingsDTO> {
    return this.followUpQueueService.getFollowUpSettings(workspace.id);
  }

  @Mutation(() => Boolean)
  @UseGuards(NoPermissionGuard)
  async setFollowUpReminder(
    @Args('messageThreadId') messageThreadId: string,
    @Args('followUpAt') followUpAt: Date,
    @AuthUser() { id: userId }: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<boolean> {
    return this.followUpQueueService.setFollowUpReminder(
      workspace.id,
      userId,
      messageThreadId,
      followUpAt,
    );
  }

  @Mutation(() => Boolean)
  @UseGuards(NoPermissionGuard)
  async snoozeFollowUpReminder(
    @Args('messageThreadId') messageThreadId: string,
    @Args('days') days: number,
    @AuthUser() { id: userId }: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<boolean> {
    return this.followUpQueueService.snoozeFollowUpReminder(
      workspace.id,
      userId,
      messageThreadId,
      days,
    );
  }

  @Mutation(() => Boolean)
  @UseGuards(NoPermissionGuard)
  async clearFollowUpReminder(
    @Args('messageThreadId') messageThreadId: string,
    @AuthUser() { id: userId }: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<boolean> {
    return this.followUpQueueService.clearFollowUpReminder(
      workspace.id,
      userId,
      messageThreadId,
    );
  }

  @Mutation(() => Boolean)
  @UseGuards(NoPermissionGuard)
  async snoozeFollowUpReminders(
    @Args('messageThreadIds', { type: () => [String] })
    messageThreadIds: string[],
    @Args('days') days: number,
    @AuthUser() { id: userId }: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<boolean> {
    await this.followUpQueueService.snoozeFollowUpReminders(
      workspace.id,
      userId,
      messageThreadIds,
      days,
    );

    return true;
  }

  @Mutation(() => Boolean)
  @UseGuards(NoPermissionGuard)
  async clearFollowUpReminders(
    @Args('messageThreadIds', { type: () => [String] })
    messageThreadIds: string[],
    @AuthUser() { id: userId }: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<boolean> {
    await this.followUpQueueService.clearFollowUpReminders(
      workspace.id,
      userId,
      messageThreadIds,
    );

    return true;
  }

  @Mutation(() => FollowUpSettingsDTO)
  @UseGuards(NoPermissionGuard)
  async updateFollowUpSettings(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args('thresholdDays', { nullable: true }) thresholdDays?: number,
    @Args('nudgeEnabled', { nullable: true }) nudgeEnabled?: boolean,
    @Args('nudgeIntervalDays', { nullable: true }) nudgeIntervalDays?: number,
    @Args('digestEnabled', { nullable: true }) digestEnabled?: boolean,
  ): Promise<FollowUpSettingsDTO> {
    return this.followUpQueueService.updateFollowUpSettings(workspace.id, {
      thresholdDays,
      nudgeEnabled,
      nudgeIntervalDays,
      digestEnabled,
    });
  }
}
