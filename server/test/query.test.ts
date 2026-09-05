import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { buildMessageQuery, senderDomainSql } from '../src/query.js';

describe('sender domains', () => {
  it('groups valid addresses and missing domains', () => {
    const database = new Database(':memory:');
    database.exec('CREATE TABLE messages (sender_email TEXT NOT NULL)');
    const insert = database.prepare('INSERT INTO messages (sender_email) VALUES (?)');
    for (const sender of ['one@example.com', 'two@example.com', 'Unknown sender', '']) {
      insert.run(sender);
    }

    const rows = database
      .prepare(
        `SELECT ${senderDomainSql} AS sender_domain, COUNT(*) AS message_count
         FROM messages GROUP BY sender_domain ORDER BY sender_domain`,
      )
      .all();

    expect(rows).toEqual([
      { sender_domain: '', message_count: 2 },
      { sender_domain: 'example.com', message_count: 2 },
    ]);
  });

  it('keeps an empty domain as an exact message filter', () => {
    const query = buildMessageQuery(7, { sender_domain: '' });

    expect(query.values).toEqual([7, '']);
    expect(query.whereSql).toContain(`${senderDomainSql} = ?`);
  });
});
