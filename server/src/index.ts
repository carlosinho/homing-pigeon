import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config, googleConfigured } from './config.js';
import { db, getAccount, type JobRecord } from './database.js';
import {
  consumeOAuthState,
  createAuthorizationUrl,
  exchangeAuthorizationCode,
} from './google-auth.js';
import { buildMessageQuery, csvCell, messageColumns } from './query.js';
import { wakeWorker } from './worker.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const idSchema = z.coerce.number().int().positive();
const jobSchema = z.object({ query: z.string().trim().min(1).max(1_000) });

function parseId(value: string): number {
  return idSchema.parse(value);
}

function accountExists(id: number) {
  return Boolean(getAccount(id));
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

app.get('/api/auth/google/start', (_request, response, next) => {
  try {
    response.json({ url: createAuthorizationUrl() });
  } catch (error) {
    next(error);
  }
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

app.post('/api/accounts/:accountId/disconnect', (request, response, next) => {
  try {
    const accountId = parseId(request.params.accountId);
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
  } catch (error) {
    next(error);
  }
});

app.post('/api/accounts/:accountId/jobs', (request, response, next) => {
  try {
    const accountId = parseId(request.params.accountId);
    if (!accountExists(accountId)) {
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
  } catch (error) {
    next(error);
  }
});

app.get('/api/accounts/:accountId/jobs', (request, response, next) => {
  try {
    const accountId = parseId(request.params.accountId);
    const jobs = db
      .prepare(
        `SELECT * FROM fetch_jobs
         WHERE account_id = ? ORDER BY id DESC LIMIT 12`,
      )
      .all(accountId);
    response.json({ jobs });
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs/:jobId/retry', (request, response, next) => {
  try {
    const jobId = parseId(request.params.jobId);
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
  } catch (error) {
    next(error);
  }
});

app.get('/api/accounts/:accountId/messages', (request, response, next) => {
  try {
    const accountId = parseId(request.params.accountId);
    const query = buildMessageQuery(accountId, request.query);
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM messages WHERE ${query.whereSql}`)
        .get(...query.values) as { count: number }
    ).count;
    const rows = db
      .prepare(
        `SELECT ${messageColumns.join(', ')}
         FROM messages WHERE ${query.whereSql}
         ORDER BY ${query.orderSql} LIMIT ? OFFSET ?`,
      )
      .all(
        ...query.values,
        query.pageSize,
        (query.page - 1) * query.pageSize,
      );
    response.json({ rows, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    next(error);
  }
});

app.get('/api/accounts/:accountId/messages.csv', (request, response, next) => {
  try {
    const accountId = parseId(request.params.accountId);
    const query = buildMessageQuery(accountId, request.query);
    const rows = db
      .prepare(
        `SELECT ${messageColumns.join(', ')}
         FROM messages WHERE ${query.whereSql} ORDER BY ${query.orderSql}`,
      )
      .iterate(...query.values) as Iterable<Record<string, unknown>>;

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="gmail-messages-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    response.write(`\ufeff${messageColumns.map(csvCell).join(',')}\r\n`);
    for (const row of rows) {
      const values = messageColumns.map((column) => {
        const value =
          column === 'received_at'
            ? new Date(Number(row[column])).toISOString()
            : row[column];
        return csvCell(value);
      });
      response.write(`${values.join(',')}\r\n`);
    }
    response.end();
  } catch (error) {
    next(error);
  }
});

function senderQuery(accountId: number, rawSearch: unknown) {
  const search = typeof rawSearch === 'string' ? rawSearch.trim() : '';
  return {
    where: search ? 'account_id = ? AND sender_email LIKE ?' : 'account_id = ?',
    values: search ? [accountId, `%${search}%`] : [accountId],
  };
}

app.get('/api/accounts/:accountId/senders', (request, response, next) => {
  try {
    const accountId = parseId(request.params.accountId);
    const { where, values } = senderQuery(accountId, request.query.search);
    const sortBy = request.query.sortBy === 'sender_email' ? 'sender_email' : 'message_count';
    const direction = request.query.sortDir === 'asc' ? 'ASC' : 'DESC';
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(request.query.pageSize) || 25));
    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM (
             SELECT sender_email FROM messages WHERE ${where} GROUP BY sender_email
           )`,
        )
        .get(...values) as { count: number }
    ).count;
    const rows = db
      .prepare(
        `SELECT sender_email, COUNT(*) AS message_count
         FROM messages WHERE ${where}
         GROUP BY sender_email
         ORDER BY ${sortBy} ${direction}, sender_email ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, pageSize, (page - 1) * pageSize);
    response.json({ rows, total, page, pageSize });
  } catch (error) {
    next(error);
  }
});

app.get('/api/accounts/:accountId/senders.csv', (request, response, next) => {
  try {
    const accountId = parseId(request.params.accountId);
    const { where, values } = senderQuery(accountId, request.query.search);
    const sortBy = request.query.sortBy === 'sender_email' ? 'sender_email' : 'message_count';
    const direction = request.query.sortDir === 'asc' ? 'ASC' : 'DESC';
    const rows = db
      .prepare(
        `SELECT sender_email, COUNT(*) AS message_count
         FROM messages WHERE ${where}
         GROUP BY sender_email
         ORDER BY ${sortBy} ${direction}, sender_email ASC`,
      )
      .iterate(...values) as Iterable<Record<string, unknown>>;

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="gmail-senders-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    response.write(`\ufeff${csvCell('sender_email')},${csvCell('message_count')}\r\n`);
    for (const row of rows) {
      response.write(
        `${csvCell(row.sender_email)},${csvCell(row.message_count)}\r\n`,
      );
    }
    response.end();
  } catch (error) {
    next(error);
  }
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
  console.log(`Mailroom is running at http://localhost:${config.port}`);
  wakeWorker();
});
