import type { ParsedQs } from 'qs';

export const messageColumns = [
  'sender_email',
  'subject',
  'received_at',
  'rfc_message_id',
  'gmail_search',
  'gmail_message_id',
  'gmail_thread_id',
  'size_bytes',
  'attachment_count',
  'attachment_bytes',
] as const;

export const messageSelectColumns = [...messageColumns, 'attachments_json'] as const;

type MessageColumn = (typeof messageColumns)[number];

export const senderDomainSql =
  "CASE WHEN instr(sender_email, '@') > 0 THEN substr(sender_email, instr(sender_email, '@') + 1) ELSE '' END";

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function likeValue(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

export type MessageQuery = {
  whereSql: string;
  values: Array<string | number>;
  orderSql: string;
  page: number;
  pageSize: number;
};

export function buildMessageQuery(
  accountId: number,
  query: ParsedQs,
): MessageQuery {
  const where = ['account_id = ?'];
  const values: Array<string | number> = [accountId];
  const search = text(query.search);

  if (search) {
    const pattern = likeValue(search);
    where.push(
      "(sender_email LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\')",
    );
    values.push(pattern, pattern);
  }

  for (const column of messageColumns) {
    const value = text(query[column]);
    if (!value) continue;
    const expression =
      column === 'received_at'
        ? "strftime('%Y-%m-%d %H:%M:%S', received_at / 1000, 'unixepoch')"
        : column;
    where.push(`${expression} LIKE ? ESCAPE '\\'`);
    values.push(likeValue(value));
  }

  if (typeof query.sender_domain === 'string') {
    where.push(`${senderDomainSql} = ?`);
    values.push(query.sender_domain.trim().toLowerCase());
  }

  const requestedSort = text(query.sortBy) as MessageColumn;
  const sortBy = messageColumns.includes(requestedSort)
    ? requestedSort
    : 'received_at';
  const sortDir = text(query.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(query.pageSize) || 25));

  return {
    whereSql: where.join(' AND '),
    values,
    orderSql: `${sortBy} ${sortDir}, id DESC`,
    page,
    pageSize,
  };
}

export function buildSenderQuery(accountId: number, query: ParsedQs) {
  const search = text(query.search);
  const whereSql = search ? 'account_id = ? AND sender_email LIKE ?' : 'account_id = ?';
  const values = search ? [accountId, `%${search}%`] : [accountId];
  const requestedSort = text(query.sortBy);
  const sortBy = ['sender_email', 'message_count', 'total_size_bytes'].includes(requestedSort)
    ? requestedSort
    : 'total_size_bytes';
  const direction = query.sortDir === 'asc' ? 'ASC' : 'DESC';

  return {
    whereSql,
    values,
    selectSql: `SELECT sender_email, COUNT(*) AS message_count,
                       COALESCE(SUM(size_bytes), 0) AS total_size_bytes
                FROM messages WHERE ${whereSql}
                GROUP BY sender_email
                ORDER BY ${sortBy} ${direction}, sender_email ASC`,
    page: Math.max(1, Number(query.page) || 1),
    pageSize: Math.min(100, Math.max(10, Number(query.pageSize) || 25)),
  };
}

export function buildDomainQuery(accountId: number, query: ParsedQs) {
  const search = text(query.search);
  const whereSql = search
    ? `account_id = ? AND ${senderDomainSql} LIKE ?`
    : 'account_id = ?';
  const values = search ? [accountId, `%${search}%`] : [accountId];
  const sortBy = query.sortBy === 'sender_domain' ? 'sender_domain' : 'message_count';
  const direction = query.sortDir === 'asc' ? 'ASC' : 'DESC';

  return {
    whereSql,
    values,
    selectSql: `SELECT ${senderDomainSql} AS sender_domain, COUNT(*) AS message_count
                FROM messages WHERE ${whereSql}
                GROUP BY sender_domain
                ORDER BY ${sortBy} ${direction}, sender_domain ASC`,
    page: Math.max(1, Number(query.page) || 1),
    pageSize: Math.min(100, Math.max(10, Number(query.pageSize) || 25)),
  };
}

export function csvCell(value: unknown): string {
  let output = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(output)) output = `'${output}`;
  return `"${output.replace(/"/g, '""')}"`;
}
