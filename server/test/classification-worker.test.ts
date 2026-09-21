import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClassificationWorker } from '../src/classification-worker.js';

const databases: Database.Database[] = [];
function fixture() {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, sender_email TEXT, subject TEXT, category TEXT);
    CREATE TABLE classification_jobs (id INTEGER PRIMARY KEY, account_id INTEGER, max_message_id INTEGER, status TEXT, processed_count INTEGER DEFAULT 0, error TEXT, message_ids_json TEXT);
    INSERT INTO messages VALUES (1, 1, 'a@example.com', 'Digest', NULL), (2, 1, 'b@example.com', 'Receipt', NULL), (3, 2, 'c@example.com', 'Trip', NULL);
    INSERT INTO classification_jobs (id, account_id, max_message_id, status) VALUES (1, 1, 2, 'queued');
  `);
  return db;
}
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });

describe('classification worker', () => {
  it('classifies only the saved page selection and skips already classified messages', async () => {
    const db = fixture();
    db.exec(`
      INSERT INTO messages VALUES (4, 1, 'd@example.com', 'Already classified', 'other');
      UPDATE classification_jobs SET max_message_id = 4, message_ids_json = '[2,3,4]';
    `);
    const classify = vi.fn().mockResolvedValue('purchases');
    await createClassificationWorker(db, classify)();
    expect(classify.mock.calls.map(([message]) => message.id)).toEqual([2]);
    expect(db.prepare('SELECT category FROM messages ORDER BY id').all()).toEqual([
      { category: null }, { category: 'purchases' }, { category: null }, { category: 'other' },
    ]);
  });

  it('keeps saved results on failure and retries only remaining messages', async () => {
    const db = fixture();
    const classify = vi.fn()
      .mockResolvedValueOnce('newsletter')
      .mockRejectedValueOnce(new Error('Jev unavailable'))
      .mockResolvedValueOnce('purchases');
    const run = createClassificationWorker(db, classify);
    await run();
    expect(db.prepare('SELECT status, processed_count, error FROM classification_jobs').get()).toEqual({ status: 'failed', processed_count: 1, error: 'Jev unavailable' });
    // The manual retry creates a new job, preserving the old failure history.
    db.exec("INSERT INTO classification_jobs (id, account_id, max_message_id, status) VALUES (2, 1, 2, 'queued')");
    await run();
    expect(classify.mock.calls.map(([message]) => message.id)).toEqual([1, 2, 2]);
    expect(db.prepare('SELECT category FROM messages ORDER BY id').all()).toEqual([{ category: 'newsletter' }, { category: 'purchases' }, { category: null }]);
    expect(db.prepare('SELECT status FROM classification_jobs WHERE id = 2').get()).toEqual({ status: 'completed' });
  });

  it('does not duplicate active work or include messages fetched after the manual trigger', async () => {
    const db = fixture();
    const classify = vi.fn(async () => {
      db.prepare("INSERT INTO messages (account_id, sender_email, subject) VALUES (1, 'new@example.com', 'New mail')").run();
      await run();
      return 'other' as const;
    });
    const run = createClassificationWorker(db, classify);
    await run();
    expect(classify).toHaveBeenCalledTimes(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE account_id = 1 AND category IS NULL').get()).toEqual({ count: 2 });
  });

  it('does not recreate a message deleted while Jev is processing it', async () => {
    const db = fixture();
    const run = createClassificationWorker(db, async (message) => {
      db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);
      return 'other';
    });
    await run();
    expect(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE account_id = 1').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT status, processed_count FROM classification_jobs').get()).toEqual({ status: 'completed', processed_count: 0 });
  });
});
