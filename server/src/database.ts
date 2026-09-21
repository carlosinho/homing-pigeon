import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });

const databasePath = join(config.dataDirectory, 'mailroom.db');
export const db = new Database(databasePath);

try {
  chmodSync(config.dataDirectory, 0o700);
  chmodSync(databasePath, 0o600);
} catch {
  // File permissions are best-effort on non-POSIX systems.
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    access_token TEXT,
    refresh_token TEXT,
    token_expiry INTEGER,
    token_scope TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS fetch_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    total_estimate INTEGER NOT NULL DEFAULT 0,
    discovered_count INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    sender_email TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    received_at INTEGER NOT NULL,
    rfc_message_id TEXT NOT NULL DEFAULT '',
    gmail_search TEXT NOT NULL DEFAULT '',
    gmail_message_id TEXT NOT NULL,
    gmail_thread_id TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    attachment_count INTEGER NOT NULL DEFAULT 0,
    attachment_bytes INTEGER NOT NULL DEFAULT 0,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, gmail_message_id)
  );

  CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    item_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS classification_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued',
    max_message_id INTEGER NOT NULL,
    total_count INTEGER NOT NULL,
    processed_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_classification_account
    ON classification_jobs(account_id, id DESC);

  CREATE INDEX IF NOT EXISTS idx_jobs_account_created
    ON fetch_jobs(account_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_jobs_status
    ON fetch_jobs(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_account_created
    ON activity_events(account_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_account_received
    ON messages(account_id, received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_account_sender
    ON messages(account_id, sender_email);
  CREATE INDEX IF NOT EXISTS idx_messages_account_subject
    ON messages(account_id, subject);
  CREATE INDEX IF NOT EXISTS idx_messages_account_size
    ON messages(account_id, size_bytes DESC);
`);

const activityEventColumns = db
  .prepare('PRAGMA table_info(activity_events)')
  .all() as Array<{ name: string }>;
if (!activityEventColumns.some((column) => column.name === 'target')) {
  db.exec("ALTER TABLE activity_events ADD COLUMN target TEXT NOT NULL DEFAULT ''");
}

const messageTableColumns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
if (!messageTableColumns.some((column) => column.name === 'category')) {
  db.exec('ALTER TABLE messages ADD COLUMN category TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_unclassified ON messages(account_id, id) WHERE category IS NULL');
const classificationJobColumns = db.prepare('PRAGMA table_info(classification_jobs)').all() as Array<{ name: string }>;
if (!classificationJobColumns.some((column) => column.name === 'message_ids_json')) {
  db.exec('ALTER TABLE classification_jobs ADD COLUMN message_ids_json TEXT');
}
db.prepare("UPDATE classification_jobs SET status = 'queued' WHERE status = 'running'").run();

db.prepare(
  `UPDATE fetch_jobs
   SET status = 'queued', error = 'The app stopped before this fetch finished.'
   WHERE status = 'running'`,
).run();

export type AccountRecord = {
  id: number;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: number | null;
  token_scope: string | null;
};

export type JobRecord = {
  id: number;
  account_id: number;
  query: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  total_estimate: number;
  discovered_count: number;
  processed_count: number;
  skipped_count: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export function getAccount(id: number): AccountRecord | undefined {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
    | AccountRecord
    | undefined;
}
