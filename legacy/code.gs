// Archived reference for the Google Sheets workflow that preceded Homing Pigeon.
const QUERY = 'after:2014/11/01 before:2015/01/01 in:inbox';

// All received mail, including archived messages:
// const QUERY = 'in:anywhere -from:me -in:drafts -in:spam -in:trash';

// Specific date range:
// const QUERY = 'in:inbox after:2025/01/01 before:2026/01/01';

const REQUEST_DELAY_MS = 300;

const HEADERS = [
  'sender_email',
  'subject',
  'rfc_message_id',
  'gmail_search',
  'gmail_message_id',
  'gmail_thread_id'
];

function exportGmailSendersAndSubjects() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();

  // Create or update the header row.
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  // Load Gmail message IDs already exported.
  // This prevents duplicate rows on subsequent runs.
  const existingMessageIds = getExistingMessageIds(sheet);

  let pageToken;
  let nextRow = Math.max(sheet.getLastRow() + 1, 2);
  let exportedCount = 0;
  let skippedCount = 0;

  do {
    const options = {
      q: QUERY,
      maxResults: 500
    };

    if (pageToken) {
      options.pageToken = pageToken;
    }

    const result = Gmail.Users.Messages.list('me', options);
    const messages = result.messages || [];
    const rows = [];

    for (const item of messages) {
      // Skip messages previously exported.
      if (existingMessageIds.has(item.id)) {
        skippedCount++;
        continue;
      }

      const message = getMessageWithRetry(item.id);

      const headers =
        message.payload && message.payload.headers
          ? message.payload.headers
          : [];

      const from = getHeader(headers, 'From');
      const subject = getHeader(headers, 'Subject');
      const rawMessageId = getHeader(headers, 'Message-ID');
      const rfcMessageId = normalizeMessageId(rawMessageId);

      const gmailSearch = rfcMessageId
        ? 'rfc822msgid:' + rfcMessageId
        : '';

      rows.push([
        extractEmailAddress(from),
        subject,
        rfcMessageId,
        gmailSearch,
        item.id,
        message.threadId || item.threadId || ''
      ]);

      existingMessageIds.add(item.id);
      exportedCount++;

      // Stay below Gmail's per-minute quota.
      Utilities.sleep(REQUEST_DELAY_MS);
    }

    if (rows.length > 0) {
      const range = sheet.getRange(
        nextRow,
        1,
        rows.length,
        HEADERS.length
      );

      // Preserve subjects and IDs as plain text.
      range.setNumberFormat('@');
      range.setValues(rows);

      nextRow += rows.length;
    }

    pageToken = result.nextPageToken;
  } while (pageToken);

  sheet.autoResizeColumns(1, HEADERS.length);

  spreadsheet.toast(
    'Added ' + exportedCount +
      ' messages; skipped ' + skippedCount +
      ' already exported messages.',
    'Gmail export',
    10
  );
}

function getExistingMessageIds(sheet) {
  const messageIds = new Set();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return messageIds;
  }

  // Gmail's internal message ID is column 5.
  const values = sheet
    .getRange(2, 5, lastRow - 1, 1)
    .getDisplayValues();

  for (const row of values) {
    const messageId = row[0].trim();

    if (messageId) {
      messageIds.add(messageId);
    }
  }

  return messageIds;
}

function getMessageWithRetry(messageId) {
  const maxAttempts = 7;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return Gmail.Users.Messages.get('me', messageId, {
        format: 'metadata',
        metadataHeaders: [
          'From',
          'Subject',
          'Message-ID'
        ]
      });
    } catch (error) {
      const isRetryable =
        /quota|rate limit|rateLimitExceeded|429/i.test(String(error));

      if (!isRetryable || attempt === maxAttempts - 1) {
        throw error;
      }

      // Exponential backoff with a small random delay.
      const delay =
        Math.min(64000, Math.pow(2, attempt) * 1000) +
        Math.floor(Math.random() * 1000);

      Utilities.sleep(delay);
    }
  }
}

function getHeader(headers, headerName) {
  const targetName = headerName.toLowerCase();

  for (const header of headers) {
    if (
      header.name &&
      header.name.toLowerCase() === targetName
    ) {
      return header.value || '';
    }
  }

  return '';
}

function normalizeMessageId(messageId) {
  if (!messageId) {
    return '';
  }

  // Gmail's search operator normally uses the ID without < >.
  return messageId
    .trim()
    .replace(/^</, '')
    .replace(/>$/, '');
}

function extractEmailAddress(fromHeader) {
  if (!fromHeader) {
    return '';
  }

  // Handles: Person Name <person@example.com>
  const angleBracketMatch = fromHeader.match(/<([^<>]+)>/);

  if (angleBracketMatch) {
    return angleBracketMatch[1].trim();
  }

  // Handles: person@example.com
  const bareEmailMatch = fromHeader.match(
    /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  );

  return bareEmailMatch
    ? bareEmailMatch[0].trim()
    : fromHeader.trim();
}
