import { google } from 'googleapis';
import { config } from './config.js';
import { db, getAccount, type JobRecord } from './database.js';
import { createOAuthClient } from './google-auth.js';
import {
  extractAttachments,
  extractEmailAddress,
  gmailMessageFields,
  getHeader,
  normalizeMessageId,
} from './parsers.js';

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

let workerActive = false;
let lastRequestAt = 0;

async function waitForRateLimit() {
  const wait = config.requestDelayMs - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function retryable(error: unknown): boolean {
  const candidate = error as {
    code?: number;
    response?: { status?: number; data?: unknown; headers?: Record<string, string> };
    message?: string;
  };
  const status = candidate.response?.status || candidate.code;
  const text = `${candidate.message || ''} ${JSON.stringify(candidate.response?.data || '')}`;
  return (
    status === 429 ||
    (typeof status === 'number' && status >= 500) ||
    (status === 403 && /quota|rate.?limit|userRateLimitExceeded/i.test(text))
  );
}

async function gmailRequest<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 7;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await waitForRateLimit();
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === maxAttempts - 1) throw error;

      const candidate = error as { response?: { headers?: Record<string, string> } };
      const retryAfter = Number(candidate.response?.headers?.['retry-after'] || 0) * 1000;
      const backoff = Math.min(64_000, 2 ** attempt * 1_000) + Math.random() * 1_000;
      await sleep(Math.max(retryAfter, backoff));
    }
  }

  throw lastError;
}

function readableError(error: unknown): string {
  const candidate = error as {
    code?: number | string;
    response?: { status?: number; data?: { error?: { message?: string } } };
    message?: string;
  };
  const status = candidate.response?.status || candidate.code;
  const message = candidate.response?.data?.error?.message || candidate.message;

  if (status === 401 || /invalid_grant|unauthorized/i.test(message || '')) {
    return 'Gmail authorization expired. Reconnect the account, then start the fetch again.';
  }
  return message || 'The fetch could not be completed.';
}

async function processJob(job: JobRecord) {
  const account = getAccount(job.account_id);
  if (!account?.refresh_token && !account?.access_token) {
    throw new Error('This Gmail account is disconnected. Connect it and try again.');
  }

  const auth = createOAuthClient(account);
  const gmail = google.gmail({ version: 'v1', auth });

  db.prepare(
    `UPDATE fetch_jobs
     SET status = 'running', started_at = CURRENT_TIMESTAMP,
         completed_at = NULL, error = NULL,
         discovered_count = 0, processed_count = 0, skipped_count = 0
     WHERE id = ?`,
  ).run(job.id);

  const findMessage = db.prepare(
    'SELECT 1 FROM messages WHERE account_id = ? AND gmail_message_id = ?',
  );
  const insertMessage = db.prepare(
    `INSERT OR IGNORE INTO messages
     (account_id, sender_email, subject, received_at, rfc_message_id,
      gmail_search, gmail_message_id, gmail_thread_id, size_bytes,
      attachment_count, attachment_bytes, attachments_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateDiscovery = db.prepare(
    'UPDATE fetch_jobs SET total_estimate = ?, discovered_count = ? WHERE id = ?',
  );
  const updateProgress = db.prepare(
    'UPDATE fetch_jobs SET processed_count = ?, skipped_count = ? WHERE id = ?',
  );

  let pageToken: string | undefined;
  let discovered = 0;
  let processed = 0;
  let skipped = 0;

  do {
    const page = await gmailRequest(() =>
      gmail.users.messages.list({
        userId: 'me',
        q: job.query,
        maxResults: 500,
        pageToken,
      }),
    );

    const messages = page.data.messages || [];
    discovered += messages.length;
    updateDiscovery.run(page.data.resultSizeEstimate || discovered, discovered, job.id);

    for (const item of messages) {
      if (!item.id) continue;

      const exists = findMessage.get(job.account_id, item.id);

      if (exists) {
        skipped += 1;
      } else {
        const response = await gmailRequest(() =>
          gmail.users.messages.get({
            userId: 'me',
            id: item.id!,
            format: 'full',
            fields: gmailMessageFields,
          }),
        );

        const headers = response.data.payload?.headers || [];
        const from = getHeader(headers, 'From');
        const subject = getHeader(headers, 'Subject');
        const rfcMessageId = normalizeMessageId(getHeader(headers, 'Message-ID'));
        const receivedAt = Number(response.data.internalDate || Date.now());
        const attachments = extractAttachments(response.data.payload);
        const attachmentBytes = attachments.reduce(
          (total, attachment) => total + attachment.sizeBytes,
          0,
        );

        insertMessage.run(
          job.account_id,
          extractEmailAddress(from),
          subject,
          receivedAt,
          rfcMessageId,
          rfcMessageId ? `rfc822msgid:${rfcMessageId}` : '',
          item.id,
          response.data.threadId || item.threadId || '',
          Math.max(0, Number(response.data.sizeEstimate) || 0),
          attachments.length,
          attachmentBytes,
          JSON.stringify(attachments),
        );
        processed += 1;
      }

      if ((processed + skipped) % 10 === 0) {
        updateProgress.run(processed, skipped, job.id);
      }
    }

    updateProgress.run(processed, skipped, job.id);
    pageToken = page.data.nextPageToken || undefined;
  } while (pageToken);

  db.prepare(
    `UPDATE fetch_jobs
     SET status = 'completed', processed_count = ?, skipped_count = ?,
         discovered_count = ?, completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(processed, skipped, discovered, job.id);
}

async function runWorker() {
  if (workerActive) return;
  workerActive = true;

  try {
    while (true) {
      const job = db
        .prepare(
          `SELECT * FROM fetch_jobs
           WHERE status = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1`,
        )
        .get() as JobRecord | undefined;
      if (!job) break;

      try {
        await processJob(job);
      } catch (error) {
        db.prepare(
          `UPDATE fetch_jobs
           SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).run(readableError(error), job.id);
      }
    }
  } finally {
    workerActive = false;
  }
}

export function wakeWorker() {
  void runWorker();
}
