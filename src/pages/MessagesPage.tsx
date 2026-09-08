import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Eye,
  ExternalLink,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount } from '../account-context';
import { api } from '../api';
import { EmptyAccount } from '../components/EmptyAccount';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { formatBytes } from '../formats';
import type { Message, MessagePage } from '../types';

const columns = [
  { key: 'sender_email', label: 'Sender', minWidth: '13rem', secondary: false },
  { key: 'subject', label: 'Subject', minWidth: '18rem', secondary: false },
  { key: 'size_bytes', label: 'Size', minWidth: '7rem', secondary: false },
  { key: 'attachment_bytes', label: 'Attachments', minWidth: '13rem', secondary: false },
  { key: 'received_at', label: 'Received', minWidth: '10rem', secondary: false },
  { key: 'rfc_message_id', label: 'RFC message ID', minWidth: '14rem', secondary: true },
  { key: 'gmail_search', label: 'Gmail search', minWidth: '13rem', secondary: true },
  { key: 'gmail_message_id', label: 'Gmail message ID', minWidth: '12rem', secondary: true },
  { key: 'gmail_thread_id', label: 'Thread ID', minWidth: '12rem', secondary: true },
] as const;

type Column = (typeof columns)[number]['key'];

const secondaryColumns = new Set<Column>([
  'rfc_message_id',
  'gmail_search',
  'gmail_message_id',
  'gmail_thread_id',
]);

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
    size_bytes: '',
    attachment_bytes: '',
  }));
  const [filtersOpen, setFiltersOpen] = useState(Boolean(searchParams.get('sender_email')));
  const [moreColumnsOpen, setMoreColumnsOpen] = useState(false);
  const [sortBy, setSortBy] = useState<Column>('size_bytes');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<MessagePage>({
    rows: [],
    total: 0,
    inventoryTotal: 0,
    page: 1,
    pageSize: 25,
  });
  const [resultAccountId, setResultAccountId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState('');
  const [deletingMessageId, setDeletingMessageId] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const params = useMemo(
    () => ({ search, ...filters, sender_domain: senderDomain, sortBy, sortDir, page, pageSize: 25 }),
    [filters, page, search, senderDomain, sortBy, sortDir],
  );

  useEffect(() => {
    if (!activeAccount) return;
    setResultAccountId(null);
    setPendingDeleteId('');
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api.messages(activeAccount.id, params);
        if (!active) return;
        setResult(result);
        setResultAccountId(activeAccount.id);
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
  }, [activeAccount, params, reloadKey]);

  const deleteMessages = async () => {
    if (
      !activeAccount ||
      resultAccountId !== activeAccount.id ||
      deleting ||
      deletingMessageId
    ) return;
    const confirmed = window.confirm(
      `Delete all locally stored messages for ${activeAccount.email}?\n\n` +
        'This includes messages hidden by the current filters. Gmail and fetch history will not be changed. A future fetch can import these messages again.',
    );
    if (!confirmed) return;

    setDeleting(true);
    setPendingDeleteId('');
    setError('');
    setNotice('');
    try {
      const { deletedCount } = await api.deleteMessages(activeAccount.id);
      setPage(1);
      setResult({ rows: [], total: 0, inventoryTotal: 0, page: 1, pageSize: 25 });
      setReloadKey((current) => current + 1);
      setNotice(
        `${deletedCount.toLocaleString()} local ${deletedCount === 1 ? 'message' : 'messages'} deleted.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete local messages.');
    } finally {
      setDeleting(false);
    }
  };

  const deleteMessage = async (message: Message) => {
    if (
      !activeAccount ||
      resultAccountId !== activeAccount.id ||
      deleting ||
      deletingMessageId
    ) return;

    setDeletingMessageId(message.gmail_message_id);
    setError('');
    setNotice('');
    try {
      const { deletedCount } = await api.deleteMessage(
        activeAccount.id,
        message.gmail_message_id,
      );
      setPendingDeleteId('');
      setPage(1);
      setReloadKey((current) => current + 1);
      setNotice(
        `${deletedCount.toLocaleString()} local ${deletedCount === 1 ? 'message' : 'messages'} deleted.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete local message.');
    } finally {
      setDeletingMessageId('');
    }
  };

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

  const toggleMoreColumns = () => {
    if (moreColumnsOpen) {
      setFilters((current) => ({
        ...current,
        rfc_message_id: '',
        gmail_search: '',
        gmail_message_id: '',
        gmail_thread_id: '',
      }));
      if (secondaryColumns.has(sortBy)) {
        setSortBy('size_bytes');
        setSortDir('desc');
      }
      setPage(1);
    }
    setMoreColumnsOpen((current) => !current);
  };

  const visibleColumns = columns.filter((column) => moreColumnsOpen || !column.secondary);

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
          activeAccount &&
          resultAccountId === activeAccount.id &&
          (result.total > 0 || result.inventoryTotal > 0) ? (
            <div className="page-actions">
              {result.total > 0 ? (
                <a className="button" href={api.messagesCsv(activeAccount.id, params)}>
                  <Download size={15} /> Export CSV
                </a>
              ) : null}
              {result.inventoryTotal > 0 ? (
                <button
                  className="button button-danger"
                  disabled={deleting || Boolean(deletingMessageId)}
                  onClick={() => void deleteMessages()}
                >
                  {deleting ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                  {deleting ? 'Deleting' : 'Wipe messages'}
                </button>
              ) : null}
            </div>
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
          <button
            className={`button button-filter ${moreColumnsOpen ? 'active' : ''}`}
            type="button"
            aria-pressed={moreColumnsOpen}
            onClick={toggleMoreColumns}
          >
            <Eye size={15} /> More columns
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

        {error ? <div className="error-banner" role="alert">{error}</div> : null}
        {notice ? <div className="notice-banner" role="status">{notice}</div> : null}

        <div className={`table-scroll ${loading ? 'table-loading' : ''}`}>
          <table>
            <thead>
              <tr>
                {visibleColumns.map((column) => (
                  <th key={column.key} style={{ minWidth: column.minWidth }}>
                    <button
                      className={column.key === sortBy ? 'sorted' : ''}
                      onClick={() => sort(column.key)}
                    >
                      {column.label} {sortIcon(column.key)}
                    </button>
                  </th>
                ))}
                <th className="sticky-action"><span className="sr-only">Actions</span></th>
              </tr>
              {filtersOpen ? (
                <tr className="filter-row">
                  {visibleColumns.map((column) => (
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
                  <td className="value-cell storage-cell">{formatBytes(message.size_bytes)}</td>
                  <td className="value-cell attachment-cell">
                    {message.attachment_count ? (
                      <details>
                        <summary>
                          {message.attachment_count.toLocaleString()} {message.attachment_count === 1 ? 'file' : 'files'} · {formatBytes(message.attachment_bytes)}
                        </summary>
                        <ul>
                          {message.attachments.map((attachment, index) => (
                            <li key={`${attachment.filename}-${index}`}>
                              <span title={attachment.filename}>{attachment.filename}</span>
                              <small>{attachment.mimeType} · {formatBytes(attachment.sizeBytes)}</small>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : '—'}
                  </td>
                  <td className="value-cell">{new Date(message.received_at).toLocaleString()}</td>
                  {moreColumnsOpen ? (
                    <>
                      <td className="value-cell" title={message.rfc_message_id}>{message.rfc_message_id || '—'}</td>
                      <td className="value-cell" title={message.gmail_search}>{message.gmail_search || '—'}</td>
                      <td className="value-cell">{message.gmail_message_id}</td>
                      <td className="value-cell">{message.gmail_thread_id}</td>
                    </>
                  ) : null}
                  <td className="sticky-action">
                    <div className="row-actions">
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
                      <button
                        className={`row-delete-button ${pendingDeleteId === message.gmail_message_id ? 'confirming' : ''}`}
                        type="button"
                        disabled={
                          resultAccountId !== activeAccount?.id ||
                          deleting ||
                          Boolean(deletingMessageId)
                        }
                        aria-label={
                          pendingDeleteId === message.gmail_message_id
                            ? 'Confirm deleting this local message'
                            : 'Delete this local message'
                        }
                        onClick={() => {
                          if (pendingDeleteId === message.gmail_message_id) {
                            void deleteMessage(message);
                          } else {
                            setPendingDeleteId(message.gmail_message_id);
                          }
                        }}
                      >
                        {deletingMessageId === message.gmail_message_id ? (
                          <LoaderCircle className="spin" size={13} />
                        ) : pendingDeleteId === message.gmail_message_id ? 'Sure?' : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !result.rows.length ? (
                <tr>
                  <td colSpan={visibleColumns.length + 1} className="table-empty">
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
