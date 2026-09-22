import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClassificationWorker } from '../src/classification-worker.js';

const databases: Database.Database[] = [];
function fixture() {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, sender_email TEXT, subject TEXT, category TEXT, probable_spam INTEGER);
    CREATE TABLE classification_jobs (id INTEGER PRIMARY KEY, account_id INTEGER, max_message_id INTEGER, status TEXT, processed_count INTEGER DEFAULT 0, error TEXT, message_ids_json TEXT);
    INSERT INTO messages VALUES (1, 1, 'a@example.com', 'Digest', NULL, NULL), (2, 1, 'b@example.com', 'Receipt', NULL, NULL), (3, 2, 'c@example.com', 'Trip', NULL, NULL);
    INSERT INTO classification_jobs (id, account_id, max_message_id, status) VALUES (1, 1, 2, 'queued');
  `);
  return db;
}
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });

describe('classification worker', () => {
  function concurrentFixture() {
    const db = fixture();
    for (let id = 4; id <= 7; id += 1) {
      db.prepare("INSERT INTO messages VALUES (?, 1, 'test@example.com', 'Digest', NULL, NULL)").run(id);
    }
    db.exec('UPDATE classification_jobs SET max_message_id = 7');
    const pending = new Map<number, {
      resolve: (result: { category: 'other'; probable_spam: boolean }) => void;
      reject: (error: Error) => void;
    }>();
    const classify = vi.fn((message: { id: number }) => new Promise<{ category: 'other'; probable_spam: boolean }>((resolve, reject) => {
      pending.set(message.id, { resolve, reject });
    }));
    const complete = async (id: number) => {
      pending.get(id)!.resolve({ category: 'other', probable_spam: false });
      await Promise.resolve();
    };
    return { db, classify, pending, complete };
  }

  it('uses four slots, saves out-of-order results immediately, and refills without duplicates', async () => {
    const { db, classify, complete } = concurrentFixture();
    const run = createClassificationWorker(db, classify);
    const running = run();
    expect(classify.mock.calls.map(([message]) => message.id)).toEqual([1, 2, 4, 5]);
    await run();
    expect(classify).toHaveBeenCalledTimes(4);
    await complete(5);
    expect(db.prepare('SELECT category FROM messages WHERE id = 5').get()).toEqual({ category: 'other' });
    expect(db.prepare('SELECT status, processed_count FROM classification_jobs').get()).toEqual({ status: 'running', processed_count: 1 });
    expect(classify.mock.calls.map(([message]) => message.id)).toEqual([1, 2, 4, 5, 6]);
    await complete(2);
    expect(classify.mock.calls.map(([message]) => message.id)).toEqual([1, 2, 4, 5, 6, 7]);
    for (const id of [1, 4, 6, 7]) await complete(id);
    await running;
    expect(db.prepare('SELECT status, processed_count FROM classification_jobs').get()).toEqual({ status: 'completed', processed_count: 6 });
  });

  it('stops scheduling on failure and drains successes before failing or starting another job', async () => {
    const { db, classify, pending, complete } = concurrentFixture();
    db.exec("INSERT INTO classification_jobs (id, account_id, max_message_id, status) VALUES (2, 2, 3, 'queued')");
    const running = createClassificationWorker(db, classify)();
    pending.get(2)!.reject(new Error('Jev unavailable'));
    await Promise.resolve();
    await complete(5);
    await complete(4);
    expect(classify).toHaveBeenCalledTimes(4);
    expect(db.prepare('SELECT status FROM classification_jobs ORDER BY id').all()).toEqual([{ status: 'running' }, { status: 'queued' }]);
    await complete(1);
    // Let the drained job finalize and the next job start.
    await vi.waitFor(() => expect(pending.has(3)).toBe(true));
    expect(db.prepare('SELECT status, processed_count, error FROM classification_jobs WHERE id = 1').get()).toEqual({ status: 'failed', processed_count: 3, error: 'Jev unavailable' });
    expect(db.prepare('SELECT id FROM messages WHERE account_id = 1 AND category IS NULL ORDER BY id').all()).toEqual([{ id: 2 }, { id: 6 }, { id: 7 }]);
    await complete(3);
    await running;
  });

  it('classifies only the saved page selection and skips already classified messages', async () => {
    const db = fixture();
    db.exec(`
      INSERT INTO messages VALUES (4, 1, 'd@example.com', 'Already classified', 'other', NULL);
      UPDATE classification_jobs SET max_message_id = 4, message_ids_json = '[2,3,4]';
    `);
    const classify = vi.fn().mockResolvedValue({ category: 'purchases', probable_spam: false });
    await createClassificationWorker(db, classify)();
    expect(classify.mock.calls.map(([message]) => message.id)).toEqual([2]);
    expect(db.prepare('SELECT category, probable_spam FROM messages ORDER BY id').all()).toEqual([
      { category: null, probable_spam: null }, { category: 'purchases', probable_spam: 0 }, { category: null, probable_spam: null }, { category: 'other', probable_spam: null },
    ]);
  });

  it('keeps saved results on failure and retries only remaining messages', async () => {
    const db = fixture();
    const classify = vi.fn()
      .mockResolvedValueOnce({ category: 'newsletter', probable_spam: true })
      .mockRejectedValueOnce(new Error('Jev unavailable'))
      .mockResolvedValueOnce({ category: 'purchases', probable_spam: false });
    const run = createClassificationWorker(db, classify);
    await run();
    expect(db.prepare('SELECT status, processed_count, error FROM classification_jobs').get()).toEqual({ status: 'failed', processed_count: 1, error: 'Jev unavailable' });
    // The manual retry creates a new job, preserving the old failure history.
    db.exec("INSERT INTO classification_jobs (id, account_id, max_message_id, status) VALUES (2, 1, 2, 'queued')");
    await run();
    expect(classify.mock.calls.map(([message]) => message.id)).toEqual([1, 2, 2]);
    expect(db.prepare('SELECT category, probable_spam FROM messages ORDER BY id').all()).toEqual([{ category: 'newsletter', probable_spam: 1 }, { category: 'purchases', probable_spam: 0 }, { category: null, probable_spam: null }]);
    expect(db.prepare('SELECT status FROM classification_jobs WHERE id = 2').get()).toEqual({ status: 'completed' });
  });

  it('does not duplicate active work or include messages fetched after the manual trigger', async () => {
    const db = fixture();
    const classify = vi.fn(async () => {
      db.prepare("INSERT INTO messages (account_id, sender_email, subject) VALUES (1, 'new@example.com', 'New mail')").run();
      await run();
      return { category: 'other' as const, probable_spam: false };
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
      return { category: 'other', probable_spam: false };
    });
    await run();
    expect(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE account_id = 1').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT status, processed_count FROM classification_jobs').get()).toEqual({ status: 'completed', processed_count: 0 });
  });
});
