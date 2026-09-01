export const normalizeInboundEmailAddress = (address: string): string => {
  const trimmedAddress = address.trim().toLowerCase();
  const angleBracketMatch = trimmedAddress.match(/<([^<>]+)>/);
  const normalizedAddress = angleBracketMatch?.[1] ?? trimmedAddress;

  return normalizedAddress.replace(/^mailto:/, '').trim();
};
