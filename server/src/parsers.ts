export type GmailHeader = {
  name?: string | null;
  value?: string | null;
};

export function getHeader(headers: GmailHeader[], headerName: string): string {
  const target = headerName.toLowerCase();
  return (
    headers.find((header) => header.name?.toLowerCase() === target)?.value || ''
  );
}

export function normalizeMessageId(messageId: string): string {
  return messageId.trim().replace(/^</, '').replace(/>$/, '');
}

export function extractEmailAddress(fromHeader: string): string {
  if (!fromHeader) return '';

  const angleBracketMatch = fromHeader.match(/<([^<>]+)>/);
  if (angleBracketMatch) return angleBracketMatch[1].trim().toLowerCase();

  const bareEmailMatch = fromHeader.match(
    /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  );

  return (bareEmailMatch?.[0] || fromHeader).trim().toLowerCase();
}
