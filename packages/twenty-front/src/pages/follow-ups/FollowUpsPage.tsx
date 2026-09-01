import { useReplyContext } from '@/activities/emails/hooks/useReplyContext';
import { useMyFollowUpItems } from '@/activities/emails/hooks/useMyFollowUpItems';
import { useOpenComposeEmailInSidePanel } from '@/side-panel/hooks/useOpenComposeEmailInSidePanel';
import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { PageTitle } from '@/ui/utilities/page-title/components/PageTitle';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { format, formatDistanceToNow } from 'date-fns';
import { useEffect, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import {
  IconCalendarEvent,
  IconCheckbox,
  IconClock,
  IconInbox,
  IconMailForward,
  IconX,
} from 'twenty-ui/icon';
import { Button, Checkbox } from 'twenty-ui/input';
import { MenuItem } from 'twenty-ui/navigation';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { type FollowUpItem } from '~/types/FollowUpItem';

const StyledHeader = styled.div`
  align-items: center;
  display: flex;
  gap: 16px;
  padding: 16px 0;
`;

const StyledHeaderTitle = styled.div`
  align-items: center;
  display: flex;
  flex: 1;
  gap: 8px;
`;

const StyledThreshold = styled.div`
  align-items: center;
  display: flex;
  gap: 8px;

  input[type='number'] {
    background: ${themeCssVariables.background.secondary};
    border: 1px solid ${themeCssVariables.border.color.medium};
    border-radius: ${themeCssVariables.border.radius.sm};
    color: ${themeCssVariables.font.color.primary};
    font-size: ${themeCssVariables.font.size.md};
    padding: 4px 8px;
    width: 56px;

    &:disabled {
      opacity: 0.5;
    }
  }

  label {
    color: ${themeCssVariables.font.color.tertiary};
    font-size: ${themeCssVariables.font.size.sm};
  }
`;

const StyledNudgeToggle = styled.div`
  align-items: center;
  display: flex;
  gap: 4px;
`;

const StyledTabBar = styled.div`
  display: flex;
  gap: 4px;
`;

const StyledTab = styled.button<{ isActive: boolean }>`
  background: ${({ isActive }) =>
    isActive ? themeCssVariables.background.transparent.light : 'transparent'};
  border: 1px solid
    ${({ isActive }) =>
      isActive ? themeCssVariables.border.color.medium : 'transparent'};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${({ isActive }) =>
    isActive
      ? themeCssVariables.font.color.primary
      : themeCssVariables.font.color.tertiary};
  cursor: pointer;
  font-family: ${themeCssVariables.font.family};
  font-size: ${themeCssVariables.font.size.md};
  padding: 6px 12px;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

const StyledEmptyState = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 48px 24px;
`;

const StyledListHeader = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: 12px;
  gap: 12px;
  padding: 8px 0;
`;

const StyledBulkBar = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  gap: 12px;
  margin: 8px 0;
  padding: 8px 12px;
`;

const StyledBulkLabel = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-size: 13px;
  font-weight: 600;
`;

const StyledRow = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding: 12px 0;
`;

const StyledRowText = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const StyledRowTitle = styled.div`
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledRowSubtitle = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledRowActions = styled.div`
  align-items: center;
  display: flex;
  flex-shrink: 0;
  gap: 8px;
`;

const StyledCustomDateInput = styled.input`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  margin: 4px 8px;
  padding: 6px 8px;
`;

type FollowUpRowHandlers = {
  onSnooze: (messageThreadId: string, days: number) => void;
  onSchedule: (messageThreadId: string, followUpAt: Date) => void;
  onClear: (messageThreadId: string) => void;
};

const SNOOZE_OPTIONS = [
  { days: 1, label: 'In 1 day' },
  { days: 3, label: 'In 3 days' },
  { days: 7, label: 'In 1 week' },
];

export const FollowUpsPage = () => {
  const { t } = useLingui();
  const {
    followUpItems,
    awaitingReplyItems,
    refetch,
    refetchAwaitingReply,
    settings,
    updateFollowUpSettings,
    snoozeFollowUpReminder,
    setFollowUpReminder,
    clearFollowUpReminder,
    snoozeFollowUpReminders,
    clearFollowUpReminders,
  } = useMyFollowUpItems();

  const [activeTab, setActiveTab] = useState<'followUps' | 'awaitingReply'>(
    'followUps',
  );
  const [thresholdInput, setThresholdInput] = useState('');
  const [nudgeEnabled, setNudgeEnabled] = useState(false);
  const [nudgeIntervalInput, setNudgeIntervalInput] = useState('');
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [bulkReplyThreadId, setBulkReplyThreadId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (isDefined(settings)) {
      setThresholdInput(String(settings.thresholdDays));
      setNudgeEnabled(settings.nudgeEnabled);
      setNudgeIntervalInput(String(settings.nudgeIntervalDays));
      setDigestEnabled(settings.digestEnabled);
    }
  }, [settings]);

  const handleSaveSettings = () => {
    const thresholdDays = Number(thresholdInput);
    const nudgeIntervalDays = Number(nudgeIntervalInput);

    if (
      Number.isInteger(thresholdDays) &&
      thresholdDays >= 1 &&
      Number.isInteger(nudgeIntervalDays) &&
      nudgeIntervalDays >= 1
    ) {
      void updateFollowUpSettings({
        thresholdDays,
        nudgeEnabled,
        nudgeIntervalDays,
        digestEnabled,
      });
    }
  };

  const handlers: FollowUpRowHandlers = {
    onSnooze: (messageThreadId, days) =>
      void snoozeFollowUpReminder(messageThreadId, days),
    onSchedule: (messageThreadId, followUpAt) =>
      void setFollowUpReminder(messageThreadId, followUpAt),
    onClear: (messageThreadId) => void clearFollowUpReminder(messageThreadId),
  };

  const handleRefresh = () => {
    void Promise.all([refetch(), refetchAwaitingReply()]);
  };

  const handleTabChange = (tab: 'followUps' | 'awaitingReply') => {
    setActiveTab(tab);
    setSelectedThreadIds([]);
  };

  const activeItems =
    activeTab === 'followUps' ? followUpItems : awaitingReplyItems;
  const isEmpty = activeItems.length === 0;
  const allSelected =
    activeItems.length > 0 &&
    activeItems.every((item) =>
      selectedThreadIds.includes(item.messageThreadId),
    );
  const someSelected = selectedThreadIds.length > 0 && !allSelected;

  const handleToggleAll = () => {
    if (allSelected) {
      setSelectedThreadIds([]);
    } else {
      setSelectedThreadIds(activeItems.map((item) => item.messageThreadId));
    }
  };

  const handleBulkSnooze = (days: number) => {
    void snoozeFollowUpReminders(selectedThreadIds, days).then(() =>
      setSelectedThreadIds([]),
    );
  };

  const handleBulkClear = () => {
    void clearFollowUpReminders(selectedThreadIds).then(() =>
      setSelectedThreadIds([]),
    );
  };

  const handleBulkReply = () => {
    const firstSelected = activeItems.find((item) =>
      selectedThreadIds.includes(item.messageThreadId),
    );

    if (isDefined(firstSelected)) {
      setBulkReplyThreadId(firstSelected.messageThreadId);
    }
  };

  const handleBulkReplyOpened = () => {
    setBulkReplyThreadId(null);
  };

  return (
    <>
      <PageTitle title={t`Follow-ups`} />
      <PageContainer>
        <StyledHeader>
          <StyledHeaderTitle>
            <IconInbox size={20} />
            <h1>{t`Follow-ups`}</h1>
          </StyledHeaderTitle>
          <StyledTabBar>
            <StyledTab
              isActive={activeTab === 'followUps'}
              onClick={() => handleTabChange('followUps')}
            >
              {t`Follow-ups`}
            </StyledTab>
            <StyledTab
              isActive={activeTab === 'awaitingReply'}
              onClick={() => handleTabChange('awaitingReply')}
            >
              {t`Awaiting your reply`}
            </StyledTab>
          </StyledTabBar>
          <StyledThreshold>
            <label>{t`Waiting threshold (days)`}</label>
            <input
              type="number"
              min={1}
              max={90}
              value={thresholdInput}
              onChange={(event) => setThresholdInput(event.target.value)}
            />
            <StyledNudgeToggle>
              <input
                type="checkbox"
                checked={nudgeEnabled}
                onChange={(event) => setNudgeEnabled(event.target.checked)}
              />
              <label>{t`Auto nudge`}</label>
            </StyledNudgeToggle>
            <StyledNudgeToggle>
              <input
                type="checkbox"
                checked={digestEnabled}
                onChange={(event) => setDigestEnabled(event.target.checked)}
              />
              <label>{t`Daily digest`}</label>
            </StyledNudgeToggle>
            <label>{t`Nudge every (days)`}</label>
            <input
              type="number"
              min={1}
              max={90}
              value={nudgeIntervalInput}
              disabled={!nudgeEnabled}
              onChange={(event) => setNudgeIntervalInput(event.target.value)}
            />
            <Button
              variant="secondary"
              size="small"
              title={t`Save`}
              onClick={handleSaveSettings}
            />
          </StyledThreshold>
          <Button
            variant="secondary"
            title={t`Refresh`}
            onClick={handleRefresh}
          />
        </StyledHeader>
        <div>
          {isEmpty ? (
            <StyledEmptyState>
              <IconMailForward size={32} />
              <p>
                {activeTab === 'followUps'
                  ? t`No emails waiting for a reply. Nice work.`
                  : t`No inbound emails waiting for your reply.`}
              </p>
            </StyledEmptyState>
          ) : (
            <>
              <StyledListHeader>
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  hoverable={false}
                  onCheckedChange={handleToggleAll}
                  aria-label={t`Select all`}
                />
                <span>
                  {selectedThreadIds.length > 0
                    ? t`${selectedThreadIds.length} selected`
                    : t`Select all`}
                </span>
              </StyledListHeader>
              {selectedThreadIds.length > 0 && (
                <StyledBulkBar>
                  <StyledBulkLabel>
                    {t`${selectedThreadIds.length} selected`}
                  </StyledBulkLabel>
                  {activeTab === 'followUps' && (
                    <Dropdown
                      dropdownId="follow-up-bulk-snooze"
                      dropdownPlacement="bottom-start"
                      dropdownOffset={{ x: 0, y: 4 }}
                      clickableComponent={
                        <Button
                          Icon={IconClock}
                          title={t`Snooze`}
                          variant="secondary"
                          size="small"
                        />
                      }
                      dropdownComponents={
                        <DropdownContent
                          widthInPixels={GenericDropdownContentWidth.Medium}
                        >
                          <DropdownMenuItemsContainer>
                            {SNOOZE_OPTIONS.map(({ days, label }) => (
                              <MenuItem
                                key={days}
                                text={t(label)}
                                LeftIcon={IconClock}
                                onClick={() => handleBulkSnooze(days)}
                              />
                            ))}
                          </DropdownMenuItemsContainer>
                        </DropdownContent>
                      }
                    />
                  )}
                  {activeTab === 'followUps' && (
                    <Button
                      Icon={IconX}
                      title={t`Clear snooze`}
                      variant="secondary"
                      size="small"
                      onClick={handleBulkClear}
                    />
                  )}
                  <Button
                    Icon={IconMailForward}
                    title={t`Reply`}
                    variant="secondary"
                    accent="blue"
                    size="small"
                    onClick={handleBulkReply}
                  />
                  <Button
                    Icon={IconCheckbox}
                    title={t`Deselect all`}
                    variant="secondary"
                    size="small"
                    onClick={() => setSelectedThreadIds([])}
                  />
                </StyledBulkBar>
              )}
              {activeItems.map((item) => (
                <FollowUpItemRow
                  key={item.messageThreadId}
                  item={item}
                  showSnoozeControls={activeTab === 'followUps'}
                  isSelected={selectedThreadIds.includes(item.messageThreadId)}
                  onToggleSelected={() =>
                    setSelectedThreadIds((current) =>
                      current.includes(item.messageThreadId)
                        ? current.filter(
                            (threadId) => threadId !== item.messageThreadId,
                          )
                        : [...current, item.messageThreadId],
                    )
                  }
                  onSnooze={handlers.onSnooze}
                  onSchedule={handlers.onSchedule}
                  onClear={handlers.onClear}
                />
              ))}
            </>
          )}
        </div>
      </PageContainer>
      <BulkReplyEffect
        threadId={bulkReplyThreadId}
        onOpened={handleBulkReplyOpened}
      />
    </>
  );
};

const FollowUpItemRow = ({
  item,
  showSnoozeControls = true,
  isSelected,
  onToggleSelected,
  onSnooze,
  onSchedule,
  onClear,
}: {
  item: FollowUpItem;
  showSnoozeControls?: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
} & FollowUpRowHandlers) => {
  const { t } = useLingui();
  const replyContext = useReplyContext(item.messageThreadId);
  const { openComposeEmailInSidePanel } = useOpenComposeEmailInSidePanel();
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [customDate, setCustomDate] = useState('');

  const handleReply = () => {
    if (!isDefined(replyContext) || replyContext.loading) {
      return;
    }

    openComposeEmailInSidePanel({
      threadId: item.messageThreadId,
      connectedAccountId: replyContext.connectedAccountId,
      defaultTo: replyContext.to,
      defaultSubject: replyContext.subject,
      defaultInReplyTo: replyContext.inReplyTo,
    });
  };

  const handleCustomDateChange = (value: string) => {
    setCustomDate(value);

    if (value.length > 0) {
      onSchedule(item.messageThreadId, new Date(`${value}T00:00:00`));
      setShowCustomDate(false);
      setCustomDate('');
    }
  };

  const senderLabel = isDefined(item.contactName)
    ? item.contactName
    : item.contactEmail;

  const isReplyReady = isDefined(replyContext) && !replyContext.loading;
  const isSnoozed = isDefined(item.snoozedUntil);

  return (
    <StyledRow>
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggleSelected}
        aria-label={t`Select ${senderLabel}`}
      />
      <StyledRowText>
        <StyledRowTitle>{item.subject ?? t`(no subject)`}</StyledRowTitle>
        <StyledRowSubtitle>
          {senderLabel}
          {isSnoozed && isDefined(item.snoozedUntil) ? (
            <>
              {' · '}
              {t`Snoozed until ${format(new Date(item.snoozedUntil), 'MMM d')}`}
            </>
          ) : (
            <>
              {' · '}
              {t`Waiting ${item.daysWaiting} ${item.daysWaiting === 1 ? 'day' : 'days'}`}
              {' · '}
              {formatDistanceToNow(
                new Date(item.lastOutboundMessageReceivedAt),
                {
                  addSuffix: true,
                },
              )}
            </>
          )}
        </StyledRowSubtitle>
      </StyledRowText>
      <StyledRowActions>
        <Button
          Icon={IconMailForward}
          title={t`Reply`}
          variant="secondary"
          accent="blue"
          size="small"
          disabled={!isReplyReady}
          onClick={handleReply}
        />
        {showSnoozeControls && (
          <Dropdown
            dropdownId={`follow-up-snooze-${item.messageThreadId}`}
            dropdownPlacement="bottom-end"
            dropdownOffset={{ x: 0, y: 8 }}
            clickableComponent={
              <Button
                Icon={IconClock}
                title={isSnoozed ? t`Snoozed` : t`Snooze`}
                variant="secondary"
                size="small"
              />
            }
            dropdownComponents={
              <DropdownContent
                widthInPixels={GenericDropdownContentWidth.Medium}
              >
                <DropdownMenuItemsContainer>
                  {SNOOZE_OPTIONS.map(({ days, label }) => (
                    <MenuItem
                      key={days}
                      text={t(label)}
                      LeftIcon={IconClock}
                      onClick={() => onSnooze(item.messageThreadId, days)}
                    />
                  ))}
                  {!showCustomDate ? (
                    <MenuItem
                      text={t`Custom date…`}
                      LeftIcon={IconCalendarEvent}
                      onClick={() => setShowCustomDate(true)}
                    />
                  ) : (
                    <StyledCustomDateInput
                      type="date"
                      value={customDate}
                      onChange={(event) =>
                        handleCustomDateChange(event.target.value)
                      }
                    />
                  )}
                  {isSnoozed && (
                    <MenuItem
                      text={t`Clear snooze`}
                      LeftIcon={IconX}
                      onClick={() => onClear(item.messageThreadId)}
                    />
                  )}
                </DropdownMenuItemsContainer>
              </DropdownContent>
            }
          />
        )}
      </StyledRowActions>
    </StyledRow>
  );
};

const BulkReplyEffect = ({
  threadId,
  onOpened,
}: {
  threadId: string | null;
  onOpened: () => void;
}) => {
  const replyContext = useReplyContext(threadId);
  const { openComposeEmailInSidePanel } = useOpenComposeEmailInSidePanel();

  useEffect(() => {
    if (
      !isDefined(threadId) ||
      !isDefined(replyContext) ||
      replyContext.loading
    ) {
      return;
    }

    openComposeEmailInSidePanel({
      threadId,
      connectedAccountId: replyContext.connectedAccountId,
      defaultTo: replyContext.to,
      defaultSubject: replyContext.subject,
      defaultInReplyTo: replyContext.inReplyTo,
    });
    onOpened();
  }, [threadId, replyContext, openComposeEmailInSidePanel, onOpened]);

  return null;
};
