import { Trans } from '@lingui/react';
import { BaseEmail } from 'src/components/BaseEmail';
import { CallToAction } from 'src/components/CallToAction';
import { MainText } from 'src/components/MainText';
import { Title } from 'src/components/Title';
import { createI18nInstance } from 'src/utils/i18n.utils';
import { type APP_LOCALES } from 'twenty-shared/translations';

export type FollowUpDigestItem = {
  subject: string | null;
  contact: string;
  daysWaiting: number;
};

type FollowUpDigestEmailProps = {
  userName: string;
  followUps: FollowUpDigestItem[];
  awaitingReplies: FollowUpDigestItem[];
  link: string;
  locale: keyof typeof APP_LOCALES;
};

const DigestItemLine = ({ item }: { item: FollowUpDigestItem }) => (
  <span>
    {'· '}
    {item.subject ?? '(no subject)'}
    {' — '}
    {item.contact}
    {' ('}
    {item.daysWaiting}
    {item.daysWaiting === 1 ? ' day' : ' days'}
    {')'}
    <br />
  </span>
);

export const FollowUpDigestEmail = ({
  userName,
  followUps,
  awaitingReplies,
  link,
  locale,
}: FollowUpDigestEmailProps) => {
  const i18n = createI18nInstance(locale);

  return (
    <BaseEmail locale={locale}>
      <Title value={i18n._('Your daily follow-up digest')} />
      <MainText>
        {userName?.length > 1 ? (
          <Trans id="Hi {userName}," values={{ userName }} />
        ) : (
          <Trans id="Hi," />
        )}
        <br />
        <br />
        <Trans id="Here is what needs your attention today." />
        <br />
        <br />
        {followUps.length > 0 ? (
          <>
            <Trans id="Waiting for a reply" />
            <br />
            {followUps.map((item, index) => (
              <DigestItemLine key={`follow-up-${index}`} item={item} />
            ))}
            <br />
          </>
        ) : (
          <></>
        )}
        {awaitingReplies.length > 0 ? (
          <>
            <Trans id="Awaiting your reply" />
            <br />
            {awaitingReplies.map((item, index) => (
              <DigestItemLine key={`awaiting-${index}`} item={item} />
            ))}
            <br />
          </>
        ) : (
          <></>
        )}
        <Trans id="Open the follow-ups page to reply, snooze, or clear each item." />
        <br />
      </MainText>
      <br />
      <CallToAction value={i18n._('Open follow-ups')} href={link} />
      <br />
      <br />
    </BaseEmail>
  );
};

FollowUpDigestEmail.PreviewProps = {
  userName: 'Jane Doe',
  followUps: [
    { subject: 'Checking in', contact: 'Alice', daysWaiting: 3 },
    { subject: 'Pricing question', contact: 'Bob', daysWaiting: 5 },
  ],
  awaitingReplies: [
    { subject: 'Meeting recap', contact: 'Carol', daysWaiting: 2 },
  ],
  link: 'https://app.twenty.com/follow-ups',
  locale: 'en',
} as FollowUpDigestEmailProps;

export default FollowUpDigestEmail;
