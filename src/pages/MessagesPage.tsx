import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  ExternalLink,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount } from '../account-context';
import { api } from '../api';
import { EmptyAccount } from '../components/EmptyAccount';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import type { Message, Page } from '../types';

const columns = [
  { key: 'sender_email', label: 'Sender', minWidth: '13rem' },
  { key: 'subject', label: 'Subject', minWidth: '18rem' },
  { key: 'received_at', label: 'Received', minWidth: '10rem' },
  { key: 'rfc_message_id', label: 'RFC message ID', minWidth: '14rem' },
  { key: 'gmail_search', label: 'Gmail search', minWidth: '13rem' },
  { key: 'gmail_message_id', label: 'Gmail message ID', minWidth: '12rem' },
  { key: 'gmail_thread_id', label: 'Thread ID', minWidth: '12rem' },
] as const;

type Column = (typeof columns)[number]['key'];

function gmailLink(email: string, message: Message) {
  const search = message.gmail_search || `subject:"${message.subject}" from:${message.sender_email}`;
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#search/${encodeURIComponent(search)}`;
}

export function MessagesPage() {
  const { activeAccount, accounts } = useAccount();
  const [searchParams, setSearchParams] = useSearchParams();
  const [senderDomain, setSenderDomain] = useState<string | undefined>(() =>
    searchParams.has('sender_domain')
      ? searchParams.get('sender_domain') || ''
      : undefined,
  );
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<Column, string>>(() => ({
    sender_email: searchParams.get('sender_email') || '',
    subject: '',
    received_at: '',
    rfc_message_id: '',
    gmail_search: '',
    gmail_message_id: '',
    gmail_thread_id: '',
  }));
  const [filtersOpen, setFiltersOpen] = useState(Boolean(searchParams.get('sender_email')));
  const [sortBy, setSortBy] = useState<Column>('received_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Message>>({ rows: [], total: 0, page: 1, pageSize: 25 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const params = useMemo(
    () => ({ search, ...filters, sender_domain: senderDomain, sortBy, sortDir, page, pageSize: 25 }),
    [filters, page, search, senderDomain, sortBy, sortDir],
  );

  useEffect(() => {
    if (!activeAccount) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api.messages(activeAccount.id, params);
        if (!active) return;
        setResult(result);
        setError('');
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not load messages.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeAccount, params]);

  const sort = (column: Column) => {
    if (column === sortBy) setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(column);
      setSortDir('asc');
    }
    setPage(1);
  };

  const sortIcon = (column: Column) => {
    if (column !== sortBy) return <ArrowUpDown size={12} />;
    return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  if (!activeAccount && accounts.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow=""
          title="Messages"
          description="Search and inspect the metadata fetched from Gmail." />
        <EmptyAccount />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow=""
        title="Messages"
        description=""
        action={
          activeAccount ? (
            <a className="button" href={api.messagesCsv(activeAccount.id, params)}>
              <Download size={15} /> Export CSV
            </a>
          ) : null
        }
      />

      <section>
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search sender or subject"
              aria-label="Search sender or subject"
            />
          </label>
          <button
            className={`button button-filter ${filtersOpen ? 'active' : ''}`}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            <SlidersHorizontal size={15} /> Column filters
          </button>
          <span className="result-count value">{result.total.toLocaleString()} messages</span>
        </div>

        {senderDomain !== undefined ? (
          <div className="active-domain-filter">
            Domain: <strong>{senderDomain || 'Unknown domain'}</strong>
            <button
              type="button"
              onClick={() => {
                setSenderDomain(undefined);
                setPage(1);
                const next = new URLSearchParams(searchParams);
                next.delete('sender_domain');
                setSearchParams(next, { replace: true });
              }}
            >
              Clear
            </button>
          </div>
        ) : null}

        {error ? <div className="error-banner">{error}</div> : null}

        <div className={`table-scroll ${loading ? 'table-loading' : ''}`}>
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} style={{ minWidth: column.minWidth }}>
                    <button
                      className={column.key === sortBy ? 'sorted' : ''}
                      onClick={() => sort(column.key)}
                    >
                      {column.label} {sortIcon(column.key)}
                    </button>
                  </th>
                ))}
                <th className="sticky-action"><span className="sr-only">Open</span></th>
              </tr>
              {filtersOpen ? (
                <tr className="filter-row">
                  {columns.map((column) => (
                    <th key={column.key}>
                      <input
                        value={filters[column.key]}
                        onChange={(event) => {
                          setFilters((current) => ({ ...current, [column.key]: event.target.value }));
                          setPage(1);
                        }}
                        placeholder={`Filter ${column.label.toLowerCase()}`}
                        aria-label={`Filter ${column.label}`}
                      />
                    </th>
                  ))}
                  <th className="sticky-action" />
                </tr>
              ) : null}
            </thead>
            <tbody>
              {result.rows.map((message) => (
                <tr key={message.gmail_message_id}>
                  <td className="sender-cell">{message.sender_email || 'Unknown sender'}</td>
                  <td className="subject-cell" title={message.subject}>{message.subject || '(No subject)'}</td>
                  <td className="value-cell">{new Date(message.received_at).toLocaleString()}</td>
                  <td className="value-cell" title={message.rfc_message_id}>{message.rfc_message_id || '—'}</td>
                  <td className="value-cell" title={message.gmail_search}>{message.gmail_search || '—'}</td>
                  <td className="value-cell">{message.gmail_message_id}</td>
                  <td className="value-cell">{message.gmail_thread_id}</td>
                  <td className="sticky-action">
                    <a
                      className="icon-button"
                      href={gmailLink(activeAccount?.email || '', message)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open message in Gmail"
                      title="Open in Gmail"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </td>
                </tr>
              ))}
              {!loading && !result.rows.length ? (
                <tr>
                  <td colSpan={8} className="table-empty">
                    No messages match these filters. Fetch mail or clear a filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={result.pageSize} total={result.total} onPage={setPage} />
      </section>
    </>
  );
}
