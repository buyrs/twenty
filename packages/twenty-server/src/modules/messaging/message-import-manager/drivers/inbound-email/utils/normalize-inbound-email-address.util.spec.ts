import { normalizeInboundEmailAddress } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/utils/normalize-inbound-email-address.util';

describe('normalizeInboundEmailAddress', () => {
  it('normalizes display-name addresses and mailto values', () => {
    expect(
      normalizeInboundEmailAddress(
        ' Support Team <mailto:Support@Example.COM> ',
      ),
    ).toBe('support@example.com');
  });

  it('normalizes plain addresses', () => {
    expect(normalizeInboundEmailAddress(' Reply+thread@Example.COM ')).toBe(
      'reply+thread@example.com',
    );
  });
});
