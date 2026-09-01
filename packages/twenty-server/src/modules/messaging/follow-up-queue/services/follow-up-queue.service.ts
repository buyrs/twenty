import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { msg } from '@lingui/core/macro';
import { FollowUpDigestEmail, renderEmail } from 'twenty-emails';
import { isDefined } from 'twenty-shared/utils';
import { Like, Not, Repository } from 'typeorm';

import { DomainServerConfigService } from 'src/engine/core-modules/domain/domain-server-config/services/domain-server-config.service';
import { EmailService } from 'src/engine/core-modules/email/email.service';
import { I18nService } from 'src/engine/core-modules/i18n/i18n.service';
import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { EmailComposerService } from 'src/engine/core-modules/tool/tools/email-tool/email-composer.service';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';
import { MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { FollowUpItemDTO } from 'src/modules/messaging/follow-up-queue/dtos/follow-up-item.dto';
import { FollowUpSettingsDTO } from 'src/modules/messaging/follow-up-queue/dtos/follow-up-settings.dto';
import { RECIPIENT_ROLES } from 'src/modules/messaging/message-import-manager/constants/recipient-roles.constant';
import { SendEmailService } from 'src/modules/messaging/message-outbound-manager/services/send-email.service';
import {
  AppPath,
  MessageChannelType,
  MessageParticipantRole,
} from 'twenty-shared/types';

// Only consider messages inside this window so the query stays bounded.
const FOLLOW_UP_LOOKBACK_DAYS = 90;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const NUDGE_BODY_MAX_QUOTED_CHARS = 500;

export const FOLLOW_UP_THRESHOLD_DAYS = 2;
export const MAX_FOLLOW_UP_THRESHOLD_DAYS = 90;
export const FOLLOW_UP_REMINDER_KEY_PREFIX = 'FOLLOW_UP_REMINDER';
export const FOLLOW_UP_NUDGE_KEY_PREFIX = 'FOLLOW_UP_NUDGE';
export const FOLLOW_UP_SETTINGS_KEY = 'FOLLOW_UP_SETTINGS';
export const NUDGE_ENABLED_DEFAULT = false;
export const NUDGE_INTERVAL_DAYS_DEFAULT = 3;
export const MAX_NUDGE_INTERVAL_DAYS = 90;
export const DIGEST_ENABLED_DEFAULT = false;

type FollowUpSettingsValue = {
  thresholdDays?: number;
  nudgeEnabled?: boolean;
  nudgeIntervalDays?: number;
  digestEnabled?: boolean;
};

type FollowUpReminderValue = {
  followUpAt?: string;
};

type FollowUpNudgeValue = {
  sentAt?: string;
};

type DerivedFollowUp = FollowUpItemDTO & {
  effectiveStart: Date;
  isSnoozed: boolean;
};

@Injectable()
export class FollowUpQueueService {
  private readonly logger = new Logger(FollowUpQueueService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly keyValuePairService: KeyValuePairService,
    private readonly emailComposerService: EmailComposerService,
    private readonly sendEmailService: SendEmailService,
    private readonly emailService: EmailService,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly domainServerConfigService: DomainServerConfigService,
    private readonly i18nService: I18nService,
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
  ) {}

  async getFollowUpItems(
    workspaceId: string,
    userWorkspaceId: string,
    userId: string,
  ): Promise<FollowUpItemDTO[]> {
    const now = new Date();
    const settings = await this.getFollowUpSettings(workspaceId);
    const windowCutoff = new Date(
      now.getTime() - FOLLOW_UP_LOOKBACK_DAYS * DAY_IN_MS,
    );
    const reminders = await this.getReminderMap(workspaceId, userId);

    const channelToAccountMap = await this.getMessageChannelToAccountMap(
      workspaceId,
      userWorkspaceId,
    );

    const messages = await this.getRecentMessages(workspaceId, windowCutoff);

    const threadsWithMessages = this.groupMessagesByThread(messages);

    const followUps: DerivedFollowUp[] = [];

    for (const messagesOfThread of threadsWithMessages.values()) {
      const latestMessage = this.getLatestMessage(messagesOfThread);

      if (
        !isDefined(latestMessage) ||
        !this.isOutbound(latestMessage) ||
        !isDefined(latestMessage.receivedAt)
      ) {
        continue;
      }

      const followUpAt = reminders.get(latestMessage.messageThreadId ?? '');

      // A scheduled reminder sets the due date itself: while it is in the future
      // the item is snoozed, once it passes the thread surfaces immediately. The
      // waiting threshold only applies to threads without a reminder.
      const isSnoozed =
        isDefined(followUpAt) && followUpAt.getTime() > now.getTime();
      const dueAt = isDefined(followUpAt)
        ? followUpAt
        : new Date(
            latestMessage.receivedAt.getTime() +
              settings.thresholdDays * DAY_IN_MS,
          );

      if (!isSnoozed && dueAt.getTime() > now.getTime()) {
        continue;
      }

      const effectiveStart = isDefined(followUpAt)
        ? followUpAt
        : latestMessage.receivedAt;

      const association = this.getAssociation(latestMessage);

      if (!isDefined(association)) {
        continue;
      }

      const connectedAccountId = channelToAccountMap.get(
        association.messageChannelId,
      );

      if (!isDefined(connectedAccountId)) {
        continue;
      }

      const contact = this.resolveContact(latestMessage);

      if (!isDefined(contact)) {
        continue;
      }

      followUps.push({
        messageThreadId: latestMessage.messageThreadId ?? '',
        subject: latestMessage.subject,
        contactEmail: contact.handle ?? '',
        contactName: contact.displayName ?? null,
        personId: contact.personId ?? null,
        connectedAccountId,
        messageChannelId: association.messageChannelId,
        lastOutboundMessageId: latestMessage.id,
        lastOutboundMessageText: latestMessage.text,
        lastOutboundMessageReceivedAt: latestMessage.receivedAt,
        followUpAt: followUpAt ?? null,
        snoozedUntil: isSnoozed ? followUpAt : null,
        daysWaiting: this.computeDaysWaiting(latestMessage.receivedAt, now),
        effectiveStart,
        isSnoozed,
      });
    }

    return followUps
      .filter((item) => isDefined(item.contactEmail))
      .sort((a, b) => {
        if (a.isSnoozed !== b.isSnoozed) {
          return a.isSnoozed ? 1 : -1;
        }

        return a.effectiveStart.getTime() - b.effectiveStart.getTime();
      })
      .map(
        ({ effectiveStart: _effectiveStart, isSnoozed: _isSnoozed, ...item }) =>
          item,
      );
  }

  async getFollowUpSettings(workspaceId: string): Promise<FollowUpSettingsDTO> {
    const settings = await this.getSettingsValue(workspaceId);

    return {
      thresholdDays:
        isDefined(settings.thresholdDays) && settings.thresholdDays > 0
          ? settings.thresholdDays
          : FOLLOW_UP_THRESHOLD_DAYS,
      nudgeEnabled: settings.nudgeEnabled ?? NUDGE_ENABLED_DEFAULT,
      nudgeIntervalDays:
        isDefined(settings.nudgeIntervalDays) && settings.nudgeIntervalDays > 0
          ? settings.nudgeIntervalDays
          : NUDGE_INTERVAL_DAYS_DEFAULT,
      digestEnabled: settings.digestEnabled ?? DIGEST_ENABLED_DEFAULT,
    };
  }

  async updateFollowUpSettings(
    workspaceId: string,
    input: {
      thresholdDays?: number;
      nudgeEnabled?: boolean;
      nudgeIntervalDays?: number;
      digestEnabled?: boolean;
    },
  ): Promise<FollowUpSettingsDTO> {
    const current = await this.getSettingsValue(workspaceId);

    const thresholdDays = isDefined(input.thresholdDays)
      ? input.thresholdDays
      : (current.thresholdDays ?? FOLLOW_UP_THRESHOLD_DAYS);
    const nudgeEnabled =
      input.nudgeEnabled ?? current.nudgeEnabled ?? NUDGE_ENABLED_DEFAULT;
    const nudgeIntervalDays = isDefined(input.nudgeIntervalDays)
      ? input.nudgeIntervalDays
      : (current.nudgeIntervalDays ?? NUDGE_INTERVAL_DAYS_DEFAULT);
    const digestEnabled =
      input.digestEnabled ?? current.digestEnabled ?? DIGEST_ENABLED_DEFAULT;

    if (
      !Number.isInteger(thresholdDays) ||
      thresholdDays < 1 ||
      thresholdDays > MAX_FOLLOW_UP_THRESHOLD_DAYS
    ) {
      throw new BadRequestException(
        `thresholdDays must be an integer between 1 and ${MAX_FOLLOW_UP_THRESHOLD_DAYS}`,
      );
    }

    if (
      !Number.isInteger(nudgeIntervalDays) ||
      nudgeIntervalDays < 1 ||
      nudgeIntervalDays > MAX_NUDGE_INTERVAL_DAYS
    ) {
      throw new BadRequestException(
        `nudgeIntervalDays must be an integer between 1 and ${MAX_NUDGE_INTERVAL_DAYS}`,
      );
    }

    await this.keyValuePairService.set({
      type: KeyValuePairType.USER_VARIABLE,
      userId: null,
      workspaceId,
      key: FOLLOW_UP_SETTINGS_KEY,
      value: { thresholdDays, nudgeEnabled, nudgeIntervalDays, digestEnabled },
    });

    return { thresholdDays, nudgeEnabled, nudgeIntervalDays, digestEnabled };
  }

  async setFollowUpReminder(
    workspaceId: string,
    userId: string,
    messageThreadId: string,
    followUpAt: Date,
  ): Promise<boolean> {
    await this.keyValuePairService.set({
      type: KeyValuePairType.USER_VARIABLE,
      userId,
      workspaceId,
      key: this.buildReminderKey(messageThreadId),
      value: { followUpAt: followUpAt.toISOString() },
    });

    return true;
  }

  async snoozeFollowUpReminder(
    workspaceId: string,
    userId: string,
    messageThreadId: string,
    days: number,
  ): Promise<boolean> {
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new BadRequestException('days must be an integer between 1 and 90');
    }

    const followUpAt = new Date(Date.now() + days * DAY_IN_MS);

    return this.setFollowUpReminder(
      workspaceId,
      userId,
      messageThreadId,
      followUpAt,
    );
  }

  async clearFollowUpReminder(
    workspaceId: string,
    userId: string,
    messageThreadId: string,
  ): Promise<boolean> {
    await this.keyValuePairService.delete({
      type: KeyValuePairType.USER_VARIABLE,
      userId,
      workspaceId,
      key: this.buildReminderKey(messageThreadId),
    });

    return true;
  }

  async snoozeFollowUpReminders(
    workspaceId: string,
    userId: string,
    messageThreadIds: string[],
    days: number,
  ): Promise<number> {
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new BadRequestException('days must be an integer between 1 and 90');
    }

    const followUpAt = new Date(Date.now() + days * DAY_IN_MS);
    let snoozed = 0;

    for (const messageThreadId of messageThreadIds) {
      if (messageThreadId.length === 0) {
        continue;
      }

      await this.setFollowUpReminder(
        workspaceId,
        userId,
        messageThreadId,
        followUpAt,
      );
      snoozed += 1;
    }

    return snoozed;
  }

  async clearFollowUpReminders(
    workspaceId: string,
    userId: string,
    messageThreadIds: string[],
  ): Promise<number> {
    let cleared = 0;

    for (const messageThreadId of messageThreadIds) {
      if (messageThreadId.length === 0) {
        continue;
      }

      await this.clearFollowUpReminder(workspaceId, userId, messageThreadId);
      cleared += 1;
    }

    return cleared;
  }

  // Sends one nudge email per thread that has passed its waiting threshold (or
  // reminder date), has not been nudged within the configured interval, and has
  // not been snoozed by anyone. Returns the number of nudges sent.
  async sendDueNudges(workspaceId: string): Promise<number> {
    const settings = await this.getFollowUpSettings(workspaceId);

    if (!settings.nudgeEnabled) {
      return 0;
    }

    const now = new Date();
    const windowCutoff = new Date(
      now.getTime() - FOLLOW_UP_LOOKBACK_DAYS * DAY_IN_MS,
    );
    const nudgeIntervalCutoff = new Date(
      now.getTime() - settings.nudgeIntervalDays * DAY_IN_MS,
    );
    const threadReminders = await this.getThreadReminderMap(workspaceId);
    const nudgeRecords = await this.getNudgeMap(workspaceId);

    const channels = await this.messageChannelRepository.find({
      where: { workspaceId, type: Not(MessageChannelType.EMAIL_GROUP) },
      relations: { connectedAccount: true },
    });

    const accountByChannelId = new Map(
      channels
        .filter((channel) => isDefined(channel.connectedAccount))
        .map((channel) => [channel.id, channel.connectedAccount.id]),
    );

    const messages = await this.getRecentMessages(workspaceId, windowCutoff);

    const threadsWithMessages = this.groupMessagesByThread(messages);
    let nudgesSent = 0;

    for (const messagesOfThread of threadsWithMessages.values()) {
      const latestMessage = this.getLatestMessage(messagesOfThread);

      if (
        !isDefined(latestMessage) ||
        !this.isOutbound(latestMessage) ||
        !isDefined(latestMessage.receivedAt) ||
        !isDefined(latestMessage.messageThreadId)
      ) {
        continue;
      }

      const association = this.getAssociation(latestMessage);

      if (!isDefined(association)) {
        continue;
      }

      const connectedAccountId = accountByChannelId.get(
        association.messageChannelId,
      );

      if (!isDefined(connectedAccountId)) {
        continue;
      }

      const threadId = latestMessage.messageThreadId;
      const threadReminderDates = threadReminders.get(threadId) ?? [];

      // A future reminder from any rep means the thread is snoozed: never nudge
      // a thread someone explicitly deferred.
      if (
        threadReminderDates.some(
          (followUpAt) => followUpAt.getTime() > now.getTime(),
        )
      ) {
        continue;
      }

      const followUpAt =
        threadReminderDates.length > 0
          ? threadReminderDates.reduce((earliest, date) =>
              date.getTime() < earliest.getTime() ? date : earliest,
            )
          : undefined;
      const dueAt = isDefined(followUpAt)
        ? followUpAt
        : new Date(
            latestMessage.receivedAt.getTime() +
              settings.thresholdDays * DAY_IN_MS,
          );

      if (dueAt.getTime() > now.getTime()) {
        continue;
      }

      const lastNudgedAt = nudgeRecords.get(threadId);

      if (
        isDefined(lastNudgedAt) &&
        lastNudgedAt.getTime() > nudgeIntervalCutoff.getTime()
      ) {
        continue;
      }

      const contact = this.resolveContact(latestMessage);

      if (!isDefined(contact) || !isDefined(contact.handle)) {
        continue;
      }

      try {
        const composed = await this.emailComposerService.composeEmail(
          {
            recipients: { to: contact.handle },
            subject: isDefined(latestMessage.subject)
              ? `Re: ${latestMessage.subject}`
              : 'Following up',
            body: this.buildNudgeBody({
              contactName: contact.displayName ?? null,
              lastMessageDate: latestMessage.receivedAt,
              lastMessageText: latestMessage.text,
            }),
            connectedAccountId,
            inReplyTo: latestMessage.headerMessageId ?? undefined,
          },
          { workspaceId },
        );

        if (!composed.success) {
          this.logger.warn(
            `Failed to compose nudge for thread ${threadId} in workspace ${workspaceId}: ${composed.output.message}`,
          );

          continue;
        }

        const sendResult = await this.sendEmailService.sendComposedEmail(
          composed.data,
        );

        try {
          await this.sendEmailService.persistSentMessage(
            sendResult,
            composed.data,
            workspaceId,
          );
        } catch (persistenceError) {
          this.logger.warn(
            `Nudge sent but persistence failed for thread ${threadId}: ${persistenceError}`,
          );
        }

        await this.keyValuePairService.set({
          type: KeyValuePairType.USER_VARIABLE,
          userId: null,
          workspaceId,
          key: this.buildNudgeKey(threadId),
          value: { sentAt: now.toISOString() },
        });

        nudgesSent += 1;
      } catch (error) {
        this.logger.error(
          `Failed to send nudge for thread ${threadId} in workspace ${workspaceId}: ${error}`,
        );
      }
    }

    if (nudgesSent > 0) {
      this.logger.log(
        `Sent ${nudgesSent} follow-up nudge(s) for workspace ${workspaceId}`,
      );
    }

    return nudgesSent;
  }

  // Sends one digest email per workspace member who currently has due follow-ups
  // or awaiting-reply items, using the transactional sender (not the rep's own
  // account, so the digest never re-enters their inbox as an importable
  // message). Returns the number of digests sent.
  async sendDueDigests(workspaceId: string): Promise<number> {
    const settings = await this.getFollowUpSettings(workspaceId);

    if (!settings.digestEnabled) {
      return 0;
    }

    const userWorkspaces = await this.userWorkspaceRepository.find({
      where: { workspaceId },
      relations: { user: true },
    });

    let digestsSent = 0;

    for (const userWorkspace of userWorkspaces) {
      const user = userWorkspace.user;

      if (
        !isDefined(user) ||
        !isDefined(user.email) ||
        user.email.length === 0
      ) {
        continue;
      }

      try {
        // Snoozed items are deliberately excluded: they are not due yet.
        const followUps = (
          await this.getFollowUpItems(workspaceId, userWorkspace.id, user.id)
        ).filter((item) => !isDefined(item.snoozedUntil));
        const awaitingReplies = await this.getAwaitingReplyItems(
          workspaceId,
          userWorkspace.id,
        );

        if (followUps.length === 0 && awaitingReplies.length === 0) {
          continue;
        }

        const toDigestItems = (items: FollowUpItemDTO[]) =>
          items.map((item) => ({
            subject: item.subject,
            contact: item.contactName ?? item.contactEmail,
            daysWaiting: item.daysWaiting,
          }));

        const link = new URL(
          AppPath.FollowUps,
          this.domainServerConfigService.getBaseUrl(),
        ).toString();
        const userName =
          `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
        const emailTemplate = FollowUpDigestEmail({
          userName,
          followUps: toDigestItems(followUps),
          awaitingReplies: toDigestItems(awaitingReplies),
          link,
          locale: userWorkspace.locale,
        });

        const html = await renderEmail(emailTemplate, { pretty: true });
        const text = await renderEmail(emailTemplate, { plainText: true });

        const i18n = this.i18nService.getI18nInstance(userWorkspace.locale);
        const subject = i18n._(msg`Your daily follow-up digest`);

        await this.emailService.send({
          from: `${this.twentyConfigService.get('EMAIL_FROM_NAME')} <${this.twentyConfigService.get('EMAIL_FROM_ADDRESS')}>`,
          to: user.email,
          subject,
          text,
          html,
        });

        digestsSent += 1;
      } catch (error) {
        this.logger.error(
          `Failed to send follow-up digest to ${user.email} in workspace ${workspaceId}: ${error}`,
        );
      }
    }

    if (digestsSent > 0) {
      this.logger.log(
        `Sent ${digestsSent} follow-up digest(s) for workspace ${workspaceId}`,
      );
    }

    return digestsSent;
  }

  // Inbound threads the rep has not answered yet: the latest message is inbound
  // and has been waiting at least as long as the configured threshold.
  async getAwaitingReplyItems(
    workspaceId: string,
    userWorkspaceId: string,
  ): Promise<FollowUpItemDTO[]> {
    const now = new Date();
    const settings = await this.getFollowUpSettings(workspaceId);
    const windowCutoff = new Date(
      now.getTime() - FOLLOW_UP_LOOKBACK_DAYS * DAY_IN_MS,
    );
    const thresholdCutoff = new Date(
      now.getTime() - settings.thresholdDays * DAY_IN_MS,
    );

    const channelToAccountMap = await this.getMessageChannelToAccountMap(
      workspaceId,
      userWorkspaceId,
    );
    const messages = await this.getRecentMessages(workspaceId, windowCutoff);
    const threadsWithMessages = this.groupMessagesByThread(messages);
    const awaitingReply: DerivedFollowUp[] = [];

    for (const messagesOfThread of threadsWithMessages.values()) {
      const latestMessage = this.getLatestMessage(messagesOfThread);

      if (
        !isDefined(latestMessage) ||
        !this.isInboundOnly(latestMessage) ||
        !isDefined(latestMessage.receivedAt) ||
        latestMessage.receivedAt.getTime() >= thresholdCutoff.getTime()
      ) {
        continue;
      }

      const association = this.getAssociation(latestMessage);

      if (!isDefined(association)) {
        continue;
      }

      const connectedAccountId = channelToAccountMap.get(
        association.messageChannelId,
      );

      if (!isDefined(connectedAccountId)) {
        continue;
      }

      const contact = this.resolveInboundContact(latestMessage);

      if (!isDefined(contact)) {
        continue;
      }

      awaitingReply.push({
        messageThreadId: latestMessage.messageThreadId ?? '',
        subject: latestMessage.subject,
        contactEmail: contact.handle ?? '',
        contactName: contact.displayName ?? null,
        personId: contact.personId ?? null,
        connectedAccountId,
        messageChannelId: association.messageChannelId,
        lastOutboundMessageId: latestMessage.id,
        lastOutboundMessageText: latestMessage.text,
        lastOutboundMessageReceivedAt: latestMessage.receivedAt,
        followUpAt: null,
        snoozedUntil: null,
        daysWaiting: this.computeDaysWaiting(latestMessage.receivedAt, now),
        effectiveStart: latestMessage.receivedAt,
        isSnoozed: false,
      });
    }

    return awaitingReply
      .filter((item) => isDefined(item.contactEmail))
      .sort(
        (a, b) =>
          a.lastOutboundMessageReceivedAt.getTime() -
          b.lastOutboundMessageReceivedAt.getTime(),
      )
      .map(
        ({ effectiveStart: _effectiveStart, isSnoozed: _isSnoozed, ...item }) =>
          item,
      );
  }

  private async getRecentMessages(
    workspaceId: string,
    windowCutoff: Date,
  ): Promise<MessageWorkspaceEntity[]> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            MessageWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );

        return messageRepository.find({
          where: { receivedAt: { gte: windowCutoff } },
          relations: {
            messageParticipants: {
              person: true,
            },
            messageChannelMessageAssociations: true,
          },
        });
      },
      buildSystemAuthContext(workspaceId),
      { lite: true },
    );
  }

  private buildReminderKey(messageThreadId: string): string {
    return `${FOLLOW_UP_REMINDER_KEY_PREFIX}:${messageThreadId}`;
  }

  private buildNudgeKey(messageThreadId: string): string {
    return `${FOLLOW_UP_NUDGE_KEY_PREFIX}:${messageThreadId}`;
  }

  private async getSettingsValue(
    workspaceId: string,
  ): Promise<FollowUpSettingsValue> {
    const [settings] = await this.keyValuePairService.get({
      type: KeyValuePairType.USER_VARIABLE,
      userId: null,
      workspaceId,
      key: FOLLOW_UP_SETTINGS_KEY,
    });

    return (settings?.value as FollowUpSettingsValue | null) ?? {};
  }

  private async getReminderMap(
    workspaceId: string,
    userId: string,
  ): Promise<Map<string, Date>> {
    const rows = await this.keyValuePairRepository.find({
      where: {
        workspaceId,
        userId,
        type: KeyValuePairType.USER_VARIABLE,
        key: Like(`${FOLLOW_UP_REMINDER_KEY_PREFIX}:%`),
      },
    });

    const reminders = this.buildReminderDatesByThread(rows);
    const earliestByThread = new Map<string, Date>();

    for (const [threadId, dates] of reminders) {
      earliestByThread.set(
        threadId,
        dates.reduce((earliest, date) =>
          date.getTime() < earliest.getTime() ? date : earliest,
        ),
      );
    }

    return earliestByThread;
  }

  // Reminders across all workspace members, keeping every date: the nudge pass
  // needs to know both the earliest (due date) and whether any future one exists
  // (snoozed by at least one rep).
  private async getThreadReminderMap(
    workspaceId: string,
  ): Promise<Map<string, Date[]>> {
    const rows = await this.keyValuePairRepository.find({
      where: {
        workspaceId,
        type: KeyValuePairType.USER_VARIABLE,
        key: Like(`${FOLLOW_UP_REMINDER_KEY_PREFIX}:%`),
      },
    });

    return this.buildReminderDatesByThread(rows);
  }

  private buildReminderDatesByThread(
    rows: KeyValuePairEntity[],
  ): Map<string, Date[]> {
    const reminders = new Map<string, Date[]>();

    for (const row of rows) {
      const threadId = row.key.slice(FOLLOW_UP_REMINDER_KEY_PREFIX.length + 1);
      const followUpAt = (row.value as FollowUpReminderValue | null)
        ?.followUpAt;

      if (isDefined(followUpAt) && threadId.length > 0) {
        const dates = reminders.get(threadId) ?? [];

        dates.push(new Date(followUpAt));
        reminders.set(threadId, dates);
      }
    }

    return reminders;
  }

  private async getNudgeMap(workspaceId: string): Promise<Map<string, Date>> {
    const rows = await this.keyValuePairRepository.find({
      where: {
        workspaceId,
        type: KeyValuePairType.USER_VARIABLE,
        key: Like(`${FOLLOW_UP_NUDGE_KEY_PREFIX}:%`),
      },
    });

    const nudges = new Map<string, Date>();

    for (const row of rows) {
      const threadId = row.key.slice(FOLLOW_UP_NUDGE_KEY_PREFIX.length + 1);
      const sentAt = (row.value as FollowUpNudgeValue | null)?.sentAt;

      if (isDefined(sentAt) && threadId.length > 0) {
        nudges.set(threadId, new Date(sentAt));
      }
    }

    return nudges;
  }

  private buildNudgeBody({
    contactName,
    lastMessageDate,
    lastMessageText,
  }: {
    contactName: string | null;
    lastMessageDate: Date;
    lastMessageText: string | null;
  }): string {
    const greeting =
      isDefined(contactName) && contactName.length > 0
        ? `Hi ${contactName},`
        : 'Hi,';
    const quotedMessage =
      isDefined(lastMessageText) && lastMessageText.trim().length > 0
        ? `\n\n> ${lastMessageText.trim().slice(0, NUDGE_BODY_MAX_QUOTED_CHARS)}\n`
        : '';
    const dateLabel = lastMessageDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    return `${greeting}

I'm following up on my message sent on ${dateLabel}:${quotedMessage}

Let me know if you need anything else.

Best regards`;
  }

  private async getMessageChannelToAccountMap(
    workspaceId: string,
    userWorkspaceId: string,
  ): Promise<Map<string, string>> {
    const channels = await this.messageChannelRepository.find({
      where: {
        workspaceId,
        connectedAccount: { userWorkspaceId },
      },
      relations: { connectedAccount: true },
    });

    return new Map(
      channels
        .filter((channel) => isDefined(channel.connectedAccount))
        .map((channel) => [channel.id, channel.connectedAccount.id]),
    );
  }

  private groupMessagesByThread(
    messages: MessageWorkspaceEntity[],
  ): Map<string, MessageWorkspaceEntity[]> {
    const grouped = new Map<string, MessageWorkspaceEntity[]>();

    for (const message of messages) {
      const threadId = message.messageThreadId;

      if (!isDefined(threadId) || threadId.length === 0) {
        continue;
      }

      const current = grouped.get(threadId) ?? [];

      current.push(message);
      grouped.set(threadId, current);
    }

    return grouped;
  }

  private getLatestMessage(
    messages: MessageWorkspaceEntity[],
  ): MessageWorkspaceEntity | undefined {
    return messages.reduce<MessageWorkspaceEntity | undefined>(
      (latest, message) => {
        if (!message.receivedAt) {
          return latest;
        }

        if (!latest || !latest.receivedAt) {
          return message;
        }

        return message.receivedAt.getTime() > latest.receivedAt.getTime()
          ? message
          : latest;
      },
      undefined,
    );
  }

  private isOutbound(message: MessageWorkspaceEntity): boolean {
    return (message.messageChannelMessageAssociations ?? []).some(
      (association) => association.direction === MessageDirection.OUTGOING,
    );
  }

  private isInboundOnly(message: MessageWorkspaceEntity): boolean {
    const associations = message.messageChannelMessageAssociations ?? [];

    return (
      associations.some(
        (association) => association.direction === MessageDirection.INCOMING,
      ) &&
      !associations.some(
        (association) => association.direction === MessageDirection.OUTGOING,
      )
    );
  }

  private getAssociation(
    message: MessageWorkspaceEntity,
  ): MessageChannelMessageAssociationWorkspaceEntity | undefined {
    return (message.messageChannelMessageAssociations ?? [])[0];
  }

  private resolveContact(
    message: MessageWorkspaceEntity,
  ): MessageParticipantWorkspaceEntity | undefined {
    return (message.messageParticipants ?? []).find(
      (participant) =>
        RECIPIENT_ROLES.includes(participant.role) &&
        !isDefined(participant.workspaceMemberId) &&
        isDefined(participant.handle) &&
        participant.handle.length > 0,
    );
  }

  private resolveInboundContact(
    message: MessageWorkspaceEntity,
  ): MessageParticipantWorkspaceEntity | undefined {
    return (message.messageParticipants ?? []).find(
      (participant) =>
        participant.role === MessageParticipantRole.FROM &&
        !isDefined(participant.workspaceMemberId) &&
        isDefined(participant.handle) &&
        participant.handle.length > 0,
    );
  }

  private computeDaysWaiting(receivedAt: Date, now: Date): number {
    const diffMs = now.getTime() - receivedAt.getTime();

    return Math.max(1, Math.floor(diffMs / DAY_IN_MS));
  }
}
