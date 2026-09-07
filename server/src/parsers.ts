export type GmailHeader = {
  name?: string | null;
  value?: string | null;
};

export type GmailMessagePart = {
  filename?: string | null;
  mimeType?: string | null;
  body?: { size?: number | null } | null;
  parts?: GmailMessagePart[] | null;
};

export type AttachmentMetadata = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

function partFields(depth: number): string {
  const fields = ['filename', 'mimeType', 'body(size)'];
  if (depth > 0) fields.push(`parts(${partFields(depth - 1)})`);
  return fields.join(',');
}

export const gmailMessageFields =
  `threadId,internalDate,sizeEstimate,payload(headers,${partFields(12)})`;

export function extractAttachments(
  root: GmailMessagePart | null | undefined,
): AttachmentMetadata[] {
  if (!root) return [];
  const attachments: AttachmentMetadata[] = [];

  const visit = (part: GmailMessagePart) => {
    const filename = part.filename?.trim() || '';
    if (filename) {
      attachments.push({
        filename,
        mimeType: part.mimeType?.trim() || 'application/octet-stream',
        sizeBytes: Math.max(0, Number(part.body?.size) || 0),
      });
    }
    for (const child of part.parts || []) visit(child);
  };

  visit(root);
  return attachments;
}

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
