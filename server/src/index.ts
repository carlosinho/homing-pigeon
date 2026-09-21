import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config, googleConfigured } from './config.js';
import { db, getAccount } from './database.js';
import {
  consumeOAuthState,
  createAuthorizationUrl,
  exchangeAuthorizationCode,
} from './google-auth.js';
import {
  buildDomainQuery,
  buildMessageQuery,
  buildSenderQuery,
  csvCell,
  messageColumns,
  messageSelectColumns,
  senderDomainSql,
} from './query.js';
import { wakeWorker } from './worker.js';
import { classifyMessage } from './jev.js';
import { createClassificationWorker } from './classification-worker.js';

const runClassificationWorker = createClassificationWorker(db, classifyMessage);
function wakeClassificationWorker() {
  if (config.typesafeApiKey) void runClassificationWorker().catch(console.error);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const idSchema = z.coerce.number().int().positive();
const jobSchema = z.object({ query: z.string().trim().min(1).max(1_000) });
const messageIdSchema = z.string().trim().min(1);
const classificationSchema = z.object({
  messageIds: z.array(messageIdSchema).min(1).max(100).optional(),
}).strict();
const senderDeleteSchema = z.object({ senderEmail: z.string().trim().min(1) });
const domainDeleteSchema = z.object({ senderDomain: z.string().trim().min(1) });

function messageResponseRow(row: Record<string, unknown>) {
  const { attachments_json: attachmentsJson, ...message } = row;
  return {
    ...message,
    attachments: JSON.parse(String(attachmentsJson || '[]')) as unknown[],
  };
}

function canDeleteStoredMessages(
  accountId: number,
  response: express.Response,
): boolean {
  if (!getAccount(accountId)) {
    response.status(404).json({ error: 'Account not found.' });
    return false;
  }

  const activeJob = db
    .prepare(
      `SELECT 1 FROM fetch_jobs
       WHERE account_id = ? AND status IN ('queued', 'running') LIMIT 1`,
    )
    .get(accountId);
  if (activeJob) {
    response.status(409).json({
      error: 'Wait for this mailbox\'s active fetches to finish before deleting its messages.',
    });
    return false;
  }

  return true;
}

function deleteStoredMessages(
  accountId: number,
  predicateSql = '',
  values: string[] = [],
  eventType = 'messages_deleted',
  target = '',
): number {
  return db.transaction(() => {
    const predicate = predicateSql ? ` AND ${predicateSql}` : '';
    const result = db
      .prepare(`DELETE FROM messages WHERE account_id = ?${predicate}`)
      .run(accountId, ...values);
    if (result.changes) {
      db.prepare(
        `INSERT INTO activity_events
           (account_id, event_type, target, item_count)
         VALUES (?, ?, ?, ?)`,
      ).run(accountId, eventType, target, result.changes);
    }
    return result.changes;
  })();
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/auth/status', (_request, response) => {
  const accounts = db
    .prepare(
      `SELECT id, email,
              CASE WHEN refresh_token IS NOT NULL OR access_token IS NOT NULL
                   THEN 1 ELSE 0 END AS connected,
              created_at, updated_at
       FROM accounts ORDER BY email COLLATE NOCASE`,
    )
    .all();
  response.json({ configured: googleConfigured, accounts });
});

app.get('/api/auth/google/start', (_request, response) => {
  response.json({ url: createAuthorizationUrl() });
});

app.get('/api/auth/google/callback', async (request, response) => {
  const code = typeof request.query.code === 'string' ? request.query.code : '';
  const state = typeof request.query.state === 'string' ? request.query.state : '';

  if (!code || !state || !consumeOAuthState(state)) {
    response.redirect(`${config.appUrl}/fetch?authError=invalid_callback`);
    return;
  }

  try {
    const accountId = await exchangeAuthorizationCode(code);
    response.redirect(`${config.appUrl}/fetch?connected=${accountId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authorization failed';
    response.redirect(
      `${config.appUrl}/fetch?authError=${encodeURIComponent(message)}`,
    );
  }
});

app.post('/api/accounts/:accountId/disconnect', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const result = db
    .prepare(
      `UPDATE accounts
       SET access_token = NULL, refresh_token = NULL, token_expiry = NULL,
           token_scope = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(accountId);
  if (!result.changes) {
    response.status(404).json({ error: 'Account not found.' });
    return;
  }
  response.status(204).end();
});

app.delete('/api/accounts/:accountId/messages', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  if (!canDeleteStoredMessages(accountId, response)) return;

  const deletedCount = deleteStoredMessages(accountId);
  response.json({ deletedCount });
});

app.delete('/api/accounts/:accountId/messages/:gmailMessageId', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const gmailMessageId = messageIdSchema.parse(request.params.gmailMessageId);
  if (!canDeleteStoredMessages(accountId, response)) return;

  const deletedCount = deleteStoredMessages(
    accountId,
    'gmail_message_id = ?',
    [gmailMessageId],
    'message_deleted',
  );
  response.json({ deletedCount });
});

app.delete('/api/accounts/:accountId/senders', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const { senderEmail } = senderDeleteSchema.parse(request.body);
  if (!canDeleteStoredMessages(accountId, response)) return;

  const deletedCount = deleteStoredMessages(
    accountId,
    'sender_email = ?',
    [senderEmail.toLowerCase()],
    'sender_messages_deleted',
    senderEmail.toLowerCase(),
  );
  response.json({ deletedCount });
});

app.delete('/api/accounts/:accountId/domains', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const { senderDomain } = domainDeleteSchema.parse(request.body);
  if (!canDeleteStoredMessages(accountId, response)) return;

  const deletedCount = deleteStoredMessages(
    accountId,
    `${senderDomainSql} = ?`,
    [senderDomain.toLowerCase()],
    'domain_messages_deleted',
    senderDomain.toLowerCase(),
  );
  response.json({ deletedCount });
});

app.post('/api/accounts/:accountId/jobs', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  if (!getAccount(accountId)) {
    response.status(404).json({ error: 'Account not found.' });
    return;
  }
  const { query } = jobSchema.parse(request.body);
  const result = db
    .prepare(
      `INSERT INTO fetch_jobs (account_id, query, status) VALUES (?, ?, 'queued')`,
    )
    .run(accountId, query);
  const job = db
    .prepare('SELECT * FROM fetch_jobs WHERE id = ?')
    .get(result.lastInsertRowid);
  wakeWorker();
  response.status(201).json(job);
});

app.get('/api/accounts/:accountId/jobs', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const jobs = db
    .prepare(
      `SELECT * FROM fetch_jobs
       WHERE account_id = ? ORDER BY id DESC LIMIT 20`,
    )
    .all(accountId);
  const activities = db
    .prepare(
      `SELECT id, account_id, event_type, target, item_count, created_at
       FROM activity_events
       WHERE account_id = ?
       ORDER BY id DESC LIMIT 20`,
    )
    .all(accountId);
  response.json({ jobs, activities });
});

app.post('/api/jobs/:jobId/retry', (request, response) => {
  const jobId = idSchema.parse(request.params.jobId);
  const result = db
    .prepare(
      `UPDATE fetch_jobs
       SET status = 'queued', error = NULL, completed_at = NULL
       WHERE id = ? AND status = 'failed'`,
    )
    .run(jobId);
  if (!result.changes) {
    response.status(409).json({ error: 'Only failed fetches can be retried.' });
    return;
  }
  const job = db.prepare('SELECT * FROM fetch_jobs WHERE id = ?').get(jobId);
  wakeWorker();
  response.json(job);
});

app.delete('/api/classifications', (_request, response) => {
  const active = db.prepare("SELECT 1 FROM classification_jobs WHERE status IN ('queued', 'running') LIMIT 1").get();
  if (active) {
    response.status(409).json({ error: 'Wait for classification to finish in all accounts before erasing classifications.' });
    return;
  }
  const result = db.prepare('UPDATE messages SET category = NULL WHERE category IS NOT NULL').run();
  response.json({ erasedCount: result.changes });
});

app.get('/api/accounts/:accountId/classification', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  if (!getAccount(accountId)) {
    response.status(404).json({ error: 'Account not found.' });
    return;
  }
  const job = db.prepare('SELECT * FROM classification_jobs WHERE account_id = ? ORDER BY id DESC LIMIT 1').get(accountId);
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM messages WHERE account_id = ? AND category IS NULL')
    .get(accountId) as { count: number };
  response.json({ configured: Boolean(config.typesafeApiKey), unclassifiedCount: count, job: job || null });
});

app.post('/api/accounts/:accountId/classification', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const { messageIds } = classificationSchema.parse(request.body ?? {});
  if (!getAccount(accountId)) {
    response.status(404).json({ error: 'Account not found.' });
    return;
  }
  if (!config.typesafeApiKey) {
    response.status(400).json({ error: 'Set TYPESAFE_API_KEY in .env and restart the server.' });
    return;
  }
  const active = db.prepare("SELECT 1 FROM classification_jobs WHERE account_id = ? AND status IN ('queued', 'running')").get(accountId);
  if (active) {
    response.status(409).json({ error: 'Classification is already queued or running for this account.' });
    return;
  }
  const selectedIds = messageIds ? db.prepare(`SELECT id FROM messages
    WHERE account_id = ? AND category IS NULL
    AND gmail_message_id IN (${messageIds.map(() => '?').join(',')})`)
    .all(accountId, ...messageIds) as Array<{ id: number }> : null;
  const { count, maxId } = selectedIds
    ? { count: selectedIds.length, maxId: Math.max(0, ...selectedIds.map((row) => row.id)) }
    : db.prepare('SELECT COUNT(*) AS count, MAX(id) AS maxId FROM messages WHERE account_id = ? AND category IS NULL')
      .get(accountId) as { count: number; maxId: number | null };
  if (!count) {
    response.status(400).json({ error: 'No unclassified messages.' });
    return;
  }
  const result = db.prepare('INSERT INTO classification_jobs (account_id, max_message_id, total_count, message_ids_json) VALUES (?, ?, ?, ?)')
    .run(accountId, maxId, count, selectedIds ? JSON.stringify(selectedIds.map((row) => row.id)) : null);
  response.status(202).json(db.prepare('SELECT * FROM classification_jobs WHERE id = ?').get(result.lastInsertRowid));
  wakeClassificationWorker();
});

app.get('/api/accounts/:accountId/messages', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const query = buildMessageQuery(accountId, request.query);
  const inventoryTotal = (
    db
      .prepare('SELECT COUNT(*) AS count FROM messages WHERE account_id = ?')
      .get(accountId) as { count: number }
  ).count;
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS count FROM messages WHERE ${query.whereSql}`)
      .get(...query.values) as { count: number }
  ).count;
  const rows = db
    .prepare(
      `SELECT ${messageSelectColumns.join(', ')}
       FROM messages WHERE ${query.whereSql}
       ORDER BY ${query.orderSql} LIMIT ? OFFSET ?`,
    )
    .all(
      ...query.values,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    ) as Record<string, unknown>[];
  response.json({
    rows: rows.map(messageResponseRow),
    total,
    inventoryTotal,
    page: query.page,
    pageSize: query.pageSize,
  });
});

app.get('/api/accounts/:accountId/messages.csv', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const query = buildMessageQuery(accountId, request.query);
  const rows = db
    .prepare(
      `SELECT ${messageSelectColumns.join(', ')}
       FROM messages WHERE ${query.whereSql} ORDER BY ${query.orderSql}`,
    )
    .iterate(...query.values) as Iterable<Record<string, unknown>>;

  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="gmail-messages-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  const csvColumns = [...messageColumns, 'attachments', 'category'] as const;
  response.write(`\ufeff${csvColumns.map(csvCell).join(',')}\r\n`);
  for (const row of rows) {
    const values = csvColumns.map((column) => {
      const value = column === 'attachments'
        ? row.attachments_json
        : column === 'received_at'
          ? new Date(Number(row[column])).toISOString()
          : row[column];
      return csvCell(value);
    });
    response.write(`${values.join(',')}\r\n`);
  }
  response.end();
});

app.get('/api/accounts/:accountId/senders', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const query = buildSenderQuery(accountId, request.query);
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
           SELECT sender_email FROM messages WHERE ${query.whereSql} GROUP BY sender_email
         )`,
      )
      .get(...query.values) as { count: number }
  ).count;
  const rows = db
    .prepare(`${query.selectSql} LIMIT ? OFFSET ?`)
    .all(...query.values, query.pageSize, (query.page - 1) * query.pageSize);
  response.json({ rows, total, page: query.page, pageSize: query.pageSize });
});

app.get('/api/accounts/:accountId/senders.csv', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const query = buildSenderQuery(accountId, request.query);
  const rows = db
    .prepare(query.selectSql)
    .iterate(...query.values) as Iterable<Record<string, unknown>>;

  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="gmail-senders-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  response.write(
    `\ufeff${['sender_email', 'message_count', 'total_size_bytes']
      .map(csvCell)
      .join(',')}\r\n`,
  );
  for (const row of rows) {
    response.write(
      `${[row.sender_email, row.message_count, row.total_size_bytes]
        .map(csvCell)
        .join(',')}\r\n`,
    );
  }
  response.end();
});

app.get('/api/accounts/:accountId/domains', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const query = buildDomainQuery(accountId, request.query);
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
           SELECT ${senderDomainSql} AS sender_domain
           FROM messages WHERE ${query.whereSql} GROUP BY sender_domain
         )`,
      )
      .get(...query.values) as { count: number }
  ).count;
  const rows = db
    .prepare(`${query.selectSql} LIMIT ? OFFSET ?`)
    .all(...query.values, query.pageSize, (query.page - 1) * query.pageSize);
  response.json({ rows, total, page: query.page, pageSize: query.pageSize });
});

app.get('/api/accounts/:accountId/domains.csv', (request, response) => {
  const accountId = idSchema.parse(request.params.accountId);
  const query = buildDomainQuery(accountId, request.query);
  const rows = db
    .prepare(query.selectSql)
    .iterate(...query.values) as Iterable<Record<string, unknown>>;

  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="gmail-domains-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  response.write(`\ufeff${csvCell('sender_domain')},${csvCell('message_count')}\r\n`);
  for (const row of rows) {
    response.write(
      `${csvCell(row.sender_domain)},${csvCell(row.message_count)}\r\n`,
    );
  }
  response.end();
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: error.issues[0]?.message || 'Invalid request.' });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  console.error(error);
  response.status(500).json({ error: message });
});

const publicDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../dist',
);
if (existsSync(publicDirectory)) {
  app.use(express.static(publicDirectory));
  app.get('/{*path}', (_request, response) => {
    response.sendFile(resolve(publicDirectory, 'index.html'));
  });
}

app.listen(config.port, '127.0.0.1', () => {
  console.log(`Homing Pigeon is running at http://localhost:${config.port}`);
  wakeWorker();
  wakeClassificationWorker();
});
