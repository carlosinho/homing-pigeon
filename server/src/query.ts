import type { ParsedQs } from 'qs';

export const messageColumns = [
  'sender_email',
  'subject',
  'received_at',
  'rfc_message_id',
  'gmail_search',
  'gmail_message_id',
  'gmail_thread_id',
] as const;

type MessageColumn = (typeof messageColumns)[number];

const columnExpressions: Record<MessageColumn, string> = {
  sender_email: 'sender_email',
  subject: 'subject',
  received_at: 'received_at',
  rfc_message_id: 'rfc_message_id',
  gmail_search: 'gmail_search',
  gmail_message_id: 'gmail_message_id',
  gmail_thread_id: 'gmail_thread_id',
};

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
  filters: Record<string, string>;
};

export function buildMessageQuery(
  accountId: number,
  query: ParsedQs,
): MessageQuery {
  const where = ['account_id = ?'];
  const values: Array<string | number> = [accountId];
  const filters: Record<string, string> = {};
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
    filters[column] = value;
    const expression =
      column === 'received_at'
        ? "strftime('%Y-%m-%d %H:%M:%S', received_at / 1000, 'unixepoch')"
        : columnExpressions[column];
    where.push(`${expression} LIKE ? ESCAPE '\\'`);
    values.push(likeValue(value));
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
    orderSql: `${columnExpressions[sortBy]} ${sortDir}, id DESC`,
    page,
    pageSize,
    filters,
  };
}

export function csvCell(value: unknown): string {
  let output = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(output)) output = `'${output}`;
  return `"${output.replace(/"/g, '""')}"`;
}
