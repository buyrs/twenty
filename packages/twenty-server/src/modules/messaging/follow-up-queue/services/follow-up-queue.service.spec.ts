import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

// renderEmail resolves through a streaming scheduler that never advances under
// the globally enabled fake timers; the real render path is covered by
// email-templates-rendering.spec.ts.
jest.mock('twenty-emails', () => ({
  ...jest.requireActual('twenty-emails'),
  renderEmail: jest.fn().mockImplementation(async (_template, options) => {
    if (options?.plainText) {
      return 'Plain Text Email';
    }

    return '<html><body>HTML email content</body></html>';
  }),
}));

import { DomainServerConfigService } from 'src/engine/core-modules/domain/domain-server-config/services/domain-server-config.service';
import { EmailService } from 'src/engine/core-modules/email/email.service';
import { I18nService } from 'src/engine/core-modules/i18n/i18n.service';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { EmailComposerService } from 'src/engine/core-modules/tool/tools/email-tool/email-composer.service';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';
import { MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { SendEmailService } from 'src/modules/messaging/message-outbound-manager/services/send-email.service';
import {
  MessageParticipantRole,
  MessageChannelType,
} from 'twenty-shared/types';
import {
  FOLLOW_UP_NUDGE_KEY_PREFIX,
  FOLLOW_UP_REMINDER_KEY_PREFIX,
  FOLLOW_UP_THRESHOLD_DAYS,
  FollowUpQueueService,
} from 'src/modules/messaging/follow-up-queue/services/follow-up-queue.service';

const DAY_MS = 24 * 60 * 60 * 1000;

const now = () => new Date();

const buildMessage = (
  overrides: Partial<MessageWorkspaceEntity>,
): MessageWorkspaceEntity =>
  ({
    id: `message-${overrides.id ?? '1'}`,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    headerMessageId: null,
    subject: null,
    text: null,
    receivedAt: now(),
    messageThreadId: 'thread-1',
    messageThread: null,
    messageParticipants: [],
    messageChannelMessageAssociations: [],
    messageCampaign: null,
    messageCampaignId: null,
    deliveryStatus: null,
    isDraft: false,
    ...overrides,
  }) as MessageWorkspaceEntity;

const buildAssociation = (
  messageId: string,
  direction: MessageDirection,
  messageChannelId: string,
): MessageChannelMessageAssociationWorkspaceEntity =>
  ({
    id: `association-${messageId}-${direction}`,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    messageExternalId: null,
    messageThreadExternalId: null,
    direction,
    messageChannelId,
    message: null,
    messageId,
    messageFolders: [],
  }) as MessageChannelMessageAssociationWorkspaceEntity;

const buildParticipant = (
  overrides: Partial<MessageParticipantWorkspaceEntity> = {},
): MessageParticipantWorkspaceEntity =>
  ({
    id: 'participant-1',
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    role: MessageParticipantRole.TO,
    handle: 'alice@example.com',
    displayName: 'Alice',
    message: null,
    messageId: 'message-1',
    person: null,
    personId: null,
    workspaceMember: null,
    workspaceMemberId: null,
    messageCampaign: null,
    messageCampaignId: null,
    ...overrides,
  }) as MessageParticipantWorkspaceEntity;

const buildChannel = (
  id: string,
  accountId: string,
  userWorkspaceId: string,
): MessageChannelEntity =>
  ({
    id,
    type: MessageChannelType.IMAP,
    connectedAccountId: accountId,
    connectedAccount: { id: accountId, userWorkspaceId },
  }) as unknown as MessageChannelEntity;

describe('FollowUpQueueService', () => {
  const buildService = (overrides?: {
    messages?: MessageWorkspaceEntity[];
    channels?: MessageChannelEntity[];
    keyValueRows?: Array<{
      key: string;
      value: Record<string, unknown> | null;
    }>;
    settings?: Array<{ value: Record<string, unknown> | null }>;
    userWorkspaces?: Array<{
      id: string;
      userId: string;
      locale: string;
      user?: {
        id: string;
        email: string;
        firstName?: string | null;
        lastName?: string | null;
      } | null;
    }>;
  }) => {
    const messages = overrides?.messages ?? ([] as MessageWorkspaceEntity[]);

    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        (fn: () => Promise<MessageWorkspaceEntity[]>) => fn(),
      ),
      getRepository: jest.fn().mockResolvedValue({
        find: jest.fn().mockResolvedValue(messages),
      }),
    } as unknown as GlobalWorkspaceOrmManager;

    const keyValuePairService = {
      get: jest.fn().mockImplementation(({ key }) => {
        if (key === undefined) {
          return Promise.resolve([]);
        }

        if (key === 'FOLLOW_UP_SETTINGS') {
          return Promise.resolve(overrides?.settings ?? []);
        }

        return Promise.resolve([]);
      }),
      set: jest.fn().mockResolvedValue(undefined),
      setIfNotExists: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(1),
    } as unknown as KeyValuePairService;

    const emailComposerService = {
      composeEmail: jest.fn().mockResolvedValue({
        success: true,
        data: {
          recipients: { to: ['alice@example.com'], cc: [], bcc: [] },
          toRecipientsDisplay: 'alice@example.com',
          sanitizedSubject: 'Re: Checking in',
          plainTextBody: 'Hi Alice,',
          sanitizedHtmlBody: '<p>Hi Alice,</p>',
          attachments: [],
          connectedAccount: { id: 'account-1' },
          messageChannelId: 'channel-1',
          shouldPersistMessage: true,
        },
      }),
    } as unknown as EmailComposerService;

    const sendEmailService = {
      sendComposedEmail: jest
        .fn()
        .mockResolvedValue({ headerMessageId: 'nudge-header-1' }),
      persistSentMessage: jest.fn().mockResolvedValue(undefined),
    } as unknown as SendEmailService;

    const messageChannelRepository = {
      find: jest.fn().mockResolvedValue(overrides?.channels ?? []),
    } as unknown as Repository<MessageChannelEntity>;

    // The service builds its reminder and nudge maps by slicing keys and
    // checking value fields, so returning every row for either prefix query is
    // safe: mismatched rows are simply ignored by the map builders.
    const keyValuePairRepository = {
      find: jest.fn().mockResolvedValue(overrides?.keyValueRows ?? []),
    } as unknown as Repository<never>;

    const userWorkspaceRepository = {
      find: jest.fn().mockResolvedValue(overrides?.userWorkspaces ?? []),
    } as unknown as Repository<UserWorkspaceEntity>;

    const emailService = {
      send: jest.fn().mockResolvedValue(undefined),
    } as unknown as EmailService;

    const twentyConfigService = {
      get: jest.fn((key: string) =>
        key === 'EMAIL_FROM_NAME'
          ? 'Twenty'
          : key === 'EMAIL_FROM_ADDRESS'
            ? 'no-reply@twenty.com'
            : undefined,
      ),
    } as unknown as TwentyConfigService;

    const domainServerConfigService = {
      getBaseUrl: jest.fn(() => new URL('https://app.twenty.com')),
    } as unknown as DomainServerConfigService;

    const i18nService = {
      getI18nInstance: jest.fn(() => ({
        _: jest.fn(() => 'Your daily follow-up digest'),
      })),
    } as unknown as I18nService;

    const service = new FollowUpQueueService(
      globalWorkspaceOrmManager,
      keyValuePairService,
      emailComposerService,
      sendEmailService,
      emailService,
      twentyConfigService,
      domainServerConfigService,
      i18nService,
      messageChannelRepository,
      keyValuePairRepository,
      userWorkspaceRepository,
    );

    return {
      service,
      keyValuePairService,
      emailComposerService,
      emailService,
    };
  };

  it('surfaces a thread whose latest message is outbound and older than the threshold', async () => {
    const threeDaysAgo = new Date(now().getTime() - 3 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: threeDaysAgo,
      subject: 'Checking in',
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service } = buildService({
      messages: [outbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
    });

    const items = await service.getFollowUpItems(
      'workspace-1',
      'user-1',
      'user-id-1',
    );

    expect(items).toHaveLength(1);
    expect(items[0].messageThreadId).toBe('thread-1');
    expect(items[0].contactEmail).toBe('alice@example.com');
    expect(items[0].connectedAccountId).toBe('account-1');
    expect(items[0].daysWaiting).toBeGreaterThanOrEqual(3);
    expect(items[0].followUpAt).toBeNull();
    expect(items[0].snoozedUntil).toBeNull();
  });

  it('excludes a thread with a recent inbound reply', async () => {
    const threeDaysAgo = new Date(now().getTime() - 3 * DAY_MS);
    const inbound = buildMessage({
      id: 'm2',
      receivedAt: threeDaysAgo,
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m2', MessageDirection.INCOMING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service } = buildService({
      messages: [inbound],
      channels: [],
    });

    const items = await service.getFollowUpItems(
      'workspace-1',
      'user-1',
      'user-id-1',
    );

    expect(items).toHaveLength(0);
  });

  it('excludes a thread whose latest outbound message is newer than the threshold', async () => {
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: now(),
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service } = buildService({
      messages: [outbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
    });

    const items = await service.getFollowUpItems(
      'workspace-1',
      'user-1',
      'user-id-1',
    );

    expect(items).toHaveLength(0);
  });

  it('surfaces a thread with a future reminder as snoozed', async () => {
    const threeDaysAgo = new Date(now().getTime() - 3 * DAY_MS);
    const inThreeDays = new Date(now().getTime() + 3 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: threeDaysAgo,
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service } = buildService({
      messages: [outbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
      keyValueRows: [
        {
          key: `${FOLLOW_UP_REMINDER_KEY_PREFIX}:thread-1`,
          value: { followUpAt: inThreeDays.toISOString() },
        },
      ],
    });

    const items = await service.getFollowUpItems(
      'workspace-1',
      'user-1',
      'user-id-1',
    );

    expect(items).toHaveLength(1);
    expect(items[0].snoozedUntil).not.toBeNull();
    expect(items[0].followUpAt).not.toBeNull();
  });

  it('surfaces a thread once its reminder date has passed even below the default threshold', async () => {
    const receivedYesterday = new Date(now().getTime() - 1 * DAY_MS);
    const reminderTwoDaysAgo = new Date(now().getTime() - 2 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: receivedYesterday,
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service } = buildService({
      messages: [outbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
      keyValueRows: [
        {
          key: `${FOLLOW_UP_REMINDER_KEY_PREFIX}:thread-1`,
          value: { followUpAt: reminderTwoDaysAgo.toISOString() },
        },
      ],
    });

    const items = await service.getFollowUpItems(
      'workspace-1',
      'user-1',
      'user-id-1',
    );

    expect(items).toHaveLength(1);
    expect(items[0].snoozedUntil).toBeNull();
  });

  it('applies the workspace threshold override', async () => {
    const threeDaysAgo = new Date(now().getTime() - 3 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: threeDaysAgo,
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service } = buildService({
      messages: [outbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
      settings: [{ value: { thresholdDays: 5 } }],
    });

    const items = await service.getFollowUpItems(
      'workspace-1',
      'user-1',
      'user-id-1',
    );

    expect(items).toHaveLength(0);
  });

  it('stores a reminder under the reminder key prefix', async () => {
    const { service, keyValuePairService } = buildService();

    await service.setFollowUpReminder(
      'workspace-1',
      'user-id-1',
      'thread-1',
      new Date(),
    );

    expect(keyValuePairService.set).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `${FOLLOW_UP_REMINDER_KEY_PREFIX}:thread-1`,
        userId: 'user-id-1',
        workspaceId: 'workspace-1',
        value: expect.objectContaining({ followUpAt: expect.any(String) }),
      }),
    );
  });

  it('snoozes several threads at once under their own reminder keys', async () => {
    const { service, keyValuePairService } = buildService();

    const snoozed = await service.snoozeFollowUpReminders(
      'workspace-1',
      'user-id-1',
      ['thread-1', 'thread-2'],
      3,
    );

    expect(snoozed).toBe(2);
    expect(keyValuePairService.set).toHaveBeenCalledTimes(2);
    expect(keyValuePairService.set).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `${FOLLOW_UP_REMINDER_KEY_PREFIX}:thread-1`,
        userId: 'user-id-1',
      }),
    );
    expect(keyValuePairService.set).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `${FOLLOW_UP_REMINDER_KEY_PREFIX}:thread-2`,
        userId: 'user-id-1',
      }),
    );
  });

  it('rejects a bulk snooze with an out of range day count', async () => {
    const { service } = buildService();

    await expect(
      service.snoozeFollowUpReminders(
        'workspace-1',
        'user-id-1',
        ['thread-1'],
        0,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears reminders for several threads at once', async () => {
    const { service, keyValuePairService } = buildService();

    const cleared = await service.clearFollowUpReminders(
      'workspace-1',
      'user-id-1',
      ['thread-1', 'thread-2'],
    );

    expect(cleared).toBe(2);
    expect(keyValuePairService.delete).toHaveBeenCalledTimes(2);
    expect(keyValuePairService.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `${FOLLOW_UP_REMINDER_KEY_PREFIX}:thread-1`,
        userId: 'user-id-1',
      }),
    );
    expect(keyValuePairService.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `${FOLLOW_UP_REMINDER_KEY_PREFIX}:thread-2`,
        userId: 'user-id-1',
      }),
    );
  });

  it('skips empty thread ids in bulk operations', async () => {
    const { service, keyValuePairService } = buildService();

    const snoozed = await service.snoozeFollowUpReminders(
      'workspace-1',
      'user-id-1',
      ['thread-1', ''],
      3,
    );
    const cleared = await service.clearFollowUpReminders(
      'workspace-1',
      'user-id-1',
      [''],
    );

    expect(snoozed).toBe(1);
    expect(cleared).toBe(0);
    expect(keyValuePairService.set).toHaveBeenCalledTimes(1);
    expect(keyValuePairService.delete).not.toHaveBeenCalled();
  });

  it('rejects an out of range threshold', async () => {
    const { service } = buildService();

    await expect(
      service.updateFollowUpSettings('workspace-1', { thresholdDays: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateFollowUpSettings('workspace-1', { thresholdDays: 91 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an out of range nudge interval', async () => {
    const { service } = buildService();

    await expect(
      service.updateFollowUpSettings('workspace-1', { nudgeIntervalDays: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateFollowUpSettings('workspace-1', { nudgeIntervalDays: 91 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sends a nudge for a due thread when nudges are enabled', async () => {
    const fiveDaysAgo = new Date(now().getTime() - 5 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: fiveDaysAgo,
      subject: 'Checking in',
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service, emailComposerService, keyValuePairService } = buildService(
      {
        messages: [outbound],
        channels: [buildChannel('channel-1', 'account-1', 'user-1')],
        settings: [
          {
            value: {
              thresholdDays: 2,
              nudgeEnabled: true,
              nudgeIntervalDays: 3,
            },
          },
        ],
      },
    );

    const nudgesSent = await service.sendDueNudges('workspace-1');

    expect(nudgesSent).toBe(1);
    expect(emailComposerService.composeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: { to: 'alice@example.com' },
        connectedAccountId: 'account-1',
      }),
      expect.objectContaining({ workspaceId: 'workspace-1' }),
    );
    expect(keyValuePairService.set).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `${FOLLOW_UP_NUDGE_KEY_PREFIX}:thread-1`,
        value: expect.objectContaining({ sentAt: expect.any(String) }),
      }),
    );
  });

  it('does not nudge when nudges are disabled', async () => {
    const fiveDaysAgo = new Date(now().getTime() - 5 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: fiveDaysAgo,
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service, emailComposerService } = buildService({
      messages: [outbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
      settings: [{ value: { thresholdDays: 2, nudgeEnabled: false } }],
    });

    const nudgesSent = await service.sendDueNudges('workspace-1');

    expect(nudgesSent).toBe(0);
    expect(emailComposerService.composeEmail).not.toHaveBeenCalled();
  });

  it('does not re-nudge a thread within the nudge interval', async () => {
    const fiveDaysAgo = new Date(now().getTime() - 5 * DAY_MS);
    const oneDayAgo = new Date(now().getTime() - 1 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: fiveDaysAgo,
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service, emailComposerService } = buildService({
      messages: [outbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
      settings: [
        {
          value: { thresholdDays: 2, nudgeEnabled: true, nudgeIntervalDays: 3 },
        },
      ],
      keyValueRows: [
        {
          key: `${FOLLOW_UP_NUDGE_KEY_PREFIX}:thread-1`,
          value: { sentAt: oneDayAgo.toISOString() },
        },
      ],
    });

    const nudgesSent = await service.sendDueNudges('workspace-1');

    expect(nudgesSent).toBe(0);
    expect(emailComposerService.composeEmail).not.toHaveBeenCalled();
  });

  it('does not nudge a snoozed thread', async () => {
    const fiveDaysAgo = new Date(now().getTime() - 5 * DAY_MS);
    const inTwoDays = new Date(now().getTime() + 2 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: fiveDaysAgo,
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service, emailComposerService } = buildService({
      messages: [outbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
      settings: [
        {
          value: { thresholdDays: 2, nudgeEnabled: true, nudgeIntervalDays: 3 },
        },
      ],
      keyValueRows: [
        {
          key: `${FOLLOW_UP_REMINDER_KEY_PREFIX}:thread-1`,
          value: { followUpAt: inTwoDays.toISOString() },
        },
      ],
    });

    const nudgesSent = await service.sendDueNudges('workspace-1');

    expect(nudgesSent).toBe(0);
    expect(emailComposerService.composeEmail).not.toHaveBeenCalled();
  });

  it('does not nudge a thread below the waiting threshold', async () => {
    const oneDayAgo = new Date(now().getTime() - 1 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: oneDayAgo,
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service, emailComposerService } = buildService({
      messages: [outbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
      settings: [
        {
          value: { thresholdDays: 2, nudgeEnabled: true, nudgeIntervalDays: 3 },
        },
      ],
    });

    const nudgesSent = await service.sendDueNudges('workspace-1');

    expect(nudgesSent).toBe(0);
    expect(emailComposerService.composeEmail).not.toHaveBeenCalled();
  });

  it('surfaces an inbound thread the rep has not answered', async () => {
    const threeDaysAgo = new Date(now().getTime() - 3 * DAY_MS);
    const inbound = buildMessage({
      id: 'm3',
      receivedAt: threeDaysAgo,
      subject: 'Question about pricing',
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m3', MessageDirection.INCOMING, 'channel-1'),
      ],
      messageParticipants: [
        buildParticipant({ role: MessageParticipantRole.FROM }),
        buildParticipant({
          id: 'participant-2',
          role: MessageParticipantRole.TO,
          handle: 'bob@example.com',
          displayName: 'Bob',
          workspaceMemberId: 'workspace-member-1',
        }),
      ],
    });

    const { service } = buildService({
      messages: [inbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
    });

    const items = await service.getAwaitingReplyItems('workspace-1', 'user-1');

    expect(items).toHaveLength(1);
    expect(items[0].messageThreadId).toBe('thread-1');
    expect(items[0].contactEmail).toBe('alice@example.com');
    expect(items[0].daysWaiting).toBeGreaterThanOrEqual(3);
    expect(items[0].snoozedUntil).toBeNull();
  });

  it('excludes an inbound thread the rep already answered', async () => {
    const threeDaysAgo = new Date(now().getTime() - 3 * DAY_MS);
    const inbound = buildMessage({
      id: 'm3',
      receivedAt: threeDaysAgo,
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m3', MessageDirection.INCOMING, 'channel-1'),
      ],
      messageParticipants: [
        buildParticipant({ role: MessageParticipantRole.FROM }),
      ],
    });
    const outboundReply = buildMessage({
      id: 'm4',
      receivedAt: new Date(now().getTime() - 1 * DAY_MS),
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m4', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [],
    });

    const { service } = buildService({
      messages: [inbound, outboundReply],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
    });

    const items = await service.getAwaitingReplyItems('workspace-1', 'user-1');

    expect(items).toHaveLength(0);
  });

  it('excludes a recent inbound message below the threshold', async () => {
    const inbound = buildMessage({
      id: 'm3',
      receivedAt: now(),
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m3', MessageDirection.INCOMING, 'channel-1'),
      ],
      messageParticipants: [
        buildParticipant({ role: MessageParticipantRole.FROM }),
      ],
    });

    const { service } = buildService({
      messages: [inbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
    });

    const items = await service.getAwaitingReplyItems('workspace-1', 'user-1');

    expect(items).toHaveLength(0);
  });

  it('exposes a fixed default threshold constant', () => {
    expect(FOLLOW_UP_THRESHOLD_DAYS).toBe(2);
  });

  it('sends a digest to a member with due follow-ups and awaiting-reply items', async () => {
    const fiveDaysAgo = new Date(now().getTime() - 5 * DAY_MS);
    const threeDaysAgo = new Date(now().getTime() - 3 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: fiveDaysAgo,
      subject: 'Checking in',
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });
    const inbound = buildMessage({
      id: 'm2',
      receivedAt: threeDaysAgo,
      subject: 'Pricing question',
      messageThreadId: 'thread-2',
      messageChannelMessageAssociations: [
        buildAssociation('m2', MessageDirection.INCOMING, 'channel-1'),
      ],
      messageParticipants: [
        buildParticipant({ role: MessageParticipantRole.FROM }),
      ],
    });

    const { service, emailService } = buildService({
      messages: [outbound, inbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
      settings: [
        {
          value: {
            thresholdDays: 2,
            nudgeEnabled: false,
            nudgeIntervalDays: 3,
            digestEnabled: true,
          },
        },
      ],
      userWorkspaces: [
        {
          id: 'user-1',
          userId: 'user-id-1',
          locale: 'en',
          user: {
            id: 'user-id-1',
            email: 'rep@example.com',
            firstName: 'Jane',
            lastName: 'Doe',
          },
        },
      ],
    });

    const digestsSent = await service.sendDueDigests('workspace-1');

    expect(digestsSent).toBe(1);
    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rep@example.com',
        subject: 'Your daily follow-up digest',
        html: expect.any(String),
        text: expect.any(String),
      }),
    );
  });

  it('does not send a digest when digests are disabled', async () => {
    const fiveDaysAgo = new Date(now().getTime() - 5 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: fiveDaysAgo,
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service, emailService } = buildService({
      messages: [outbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
      settings: [
        {
          value: {
            thresholdDays: 2,
            nudgeEnabled: false,
            nudgeIntervalDays: 3,
            digestEnabled: false,
          },
        },
      ],
      userWorkspaces: [
        {
          id: 'user-1',
          userId: 'user-id-1',
          locale: 'en',
          user: { id: 'user-id-1', email: 'rep@example.com' },
        },
      ],
    });

    const digestsSent = await service.sendDueDigests('workspace-1');

    expect(digestsSent).toBe(0);
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('does not send a digest to a member with nothing due', async () => {
    const { service, emailService } = buildService({
      settings: [{ value: { thresholdDays: 2, digestEnabled: true } }],
      userWorkspaces: [
        {
          id: 'user-1',
          userId: 'user-id-1',
          locale: 'en',
          user: { id: 'user-id-1', email: 'rep@example.com' },
        },
      ],
    });

    const digestsSent = await service.sendDueDigests('workspace-1');

    expect(digestsSent).toBe(0);
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('excludes snoozed follow-ups from the digest', async () => {
    const fiveDaysAgo = new Date(now().getTime() - 5 * DAY_MS);
    const inTwoDays = new Date(now().getTime() + 2 * DAY_MS);
    const outbound = buildMessage({
      id: 'm1',
      receivedAt: fiveDaysAgo,
      messageThreadId: 'thread-1',
      messageChannelMessageAssociations: [
        buildAssociation('m1', MessageDirection.OUTGOING, 'channel-1'),
      ],
      messageParticipants: [buildParticipant()],
    });

    const { service, emailService } = buildService({
      messages: [outbound],
      channels: [buildChannel('channel-1', 'account-1', 'user-1')],
      settings: [{ value: { thresholdDays: 2, digestEnabled: true } }],
      userWorkspaces: [
        {
          id: 'user-1',
          userId: 'user-id-1',
          locale: 'en',
          user: { id: 'user-id-1', email: 'rep@example.com' },
        },
      ],
      keyValueRows: [
        {
          key: `${FOLLOW_UP_REMINDER_KEY_PREFIX}:thread-1`,
          value: { followUpAt: inTwoDays.toISOString() },
        },
      ],
    });

    const digestsSent = await service.sendDueDigests('workspace-1');

    expect(digestsSent).toBe(0);
    expect(emailService.send).not.toHaveBeenCalled();
  });
});
