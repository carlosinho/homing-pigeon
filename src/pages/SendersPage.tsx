import {
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  LoaderCircle,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../account-context';
import { api } from '../api';
import { EmptyAccount } from '../components/EmptyAccount';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { formatBytes } from '../formats';
import type { Page, Sender } from '../types';

function gmailSenderLink(email: string, senderEmail: string) {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#search/${encodeURIComponent(`from:${senderEmail}`)}`;
}

export function SendersPage() {
  const { activeAccount, accounts } = useAccount();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'sender_email' | 'message_count' | 'total_size_bytes'>('total_size_bytes');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Sender>>({ rows: [], total: 0, page: 1, pageSize: 25 });
  const [resultAccountId, setResultAccountId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingDeleteSender, setPendingDeleteSender] = useState('');
  const [deletingSender, setDeletingSender] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const params = useMemo(
    () => ({ search, sortBy, sortDir, page, pageSize: 25 }),
    [page, search, sortBy, sortDir],
  );

  useEffect(() => {
    if (!activeAccount) return;
    setResultAccountId(null);
    setPendingDeleteSender('');
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api.senders(activeAccount.id, params);
        if (!active) return;
        setResult(result);
        setResultAccountId(activeAccount.id);
        setError('');
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not load senders.');
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

  const deleteSender = async (sender: Sender) => {
    if (
      !activeAccount ||
      resultAccountId !== activeAccount.id ||
      deletingSender ||
      !sender.sender_email
    ) return;

    setDeletingSender(sender.sender_email);
    setError('');
    setNotice('');
    try {
      const { deletedCount } = await api.deleteSender(
        activeAccount.id,
        sender.sender_email,
      );
      setPendingDeleteSender('');
      setPage(1);
      setReloadKey((current) => current + 1);
      setNotice(
        `${deletedCount.toLocaleString()} local ${deletedCount === 1 ? 'message' : 'messages'} deleted.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete local sender messages.');
    } finally {
      setDeletingSender('');
    }
  };

  const toggleSort = (column: 'sender_email' | 'message_count' | 'total_size_bytes') => {
    if (sortBy === column) setSortDir((value) => (value === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(column);
      setSortDir(column === 'sender_email' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const largest = result.rows.reduce((max, sender) => Math.max(max, sender.total_size_bytes), 0);

  if (!activeAccount && accounts.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Volume" title="Senders" description="See who occupies the most space in your mailbox." />
        <EmptyAccount />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow=""
        title="Senders"
        description=""
        action={
          activeAccount && result.total > 0 ? (
            <a className="button" href={api.sendersCsv(activeAccount.id, params)}>
              <Download size={15} /> Export CSV
            </a>
          ) : null
        }
      />

      <section>
        <div className="sender-summary">
          <strong className="value">{result.total.toLocaleString()} unique senders</strong>
          <p>Each row is one address, counted across every message fetched for this mailbox. Select a row to see its messages.</p>
        </div>

        <div className="table-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Find a sender"
              aria-label="Find a sender"
            />
          </label>
        </div>
        {error ? <div className="error-banner" role="alert">{error}</div> : null}
        {notice ? <div className="notice-banner" role="status">{notice}</div> : null}
        <div className={`table-scroll ${loading ? 'table-loading' : ''}`}>
          <table className="sender-table">
            <thead>
              <tr>
                <th className="rank-column"><span className="sr-only">Rank</span></th>
                <th>
                  <button
                    className={sortBy === 'sender_email' ? 'sorted' : ''}
                    onClick={() => toggleSort('sender_email')}
                  >
                    Sender
                    {sortBy === 'sender_email' ? sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
                  </button>
                </th>
                <th className="volume-column"><span className="sr-only">Share of the largest sender by storage on this page</span></th>
                <th className="storage-column">
                  <button
                    className={sortBy === 'total_size_bytes' ? 'sorted' : ''}
                    onClick={() => toggleSort('total_size_bytes')}
                  >
                    Storage
                    {sortBy === 'total_size_bytes' ? sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
                  </button>
                </th>
                <th className="count-column">
                  <button
                    className={sortBy === 'message_count' ? 'sorted' : ''}
                    onClick={() => toggleSort('message_count')}
                  >
                    Messages
                    {sortBy === 'message_count' ? sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
                  </button>
                </th>
                <th className="row-delete-column"><span className="sr-only">Delete</span></th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((sender, index) => (
                <tr
                  key={sender.sender_email || `unknown-${index}`}
                  className="clickable-row"
                  onClick={() => navigate(`/messages?sender_email=${encodeURIComponent(sender.sender_email)}`)}
                >
                  <td className="rank-column value">
                    {String((page - 1) * result.pageSize + index + 1).padStart(2, '0')}
                  </td>
                  <td className="sender-cell">
                    <span className="sender-with-action">
                      <span>{sender.sender_email || 'Unknown sender'}</span>
                      {sender.sender_email && resultAccountId === activeAccount?.id ? (
                        <a
                          className="icon-button sender-gmail-link"
                          href={gmailSenderLink(activeAccount?.email || '', sender.sender_email)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Search Gmail for messages from ${sender.sender_email}`}
                          title="Search sender in Gmail"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ExternalLink size={14} />
                        </a>
                      ) : null}
                    </span>
                  </td>
                  <td className="volume-column">
                    <span
                      className="volume"
                      style={{ width: `${largest ? (sender.total_size_bytes / largest) * 100 : 0}%` }}
                      aria-hidden="true"
                    />
                  </td>
                  <td className="storage-column value">{formatBytes(sender.total_size_bytes)}</td>
                  <td className="count-column value">{sender.message_count.toLocaleString()}</td>
                  <td className="row-delete-column" onClick={(event) => event.stopPropagation()}>
                    {sender.sender_email && resultAccountId === activeAccount?.id ? (
                      <button
                        className={`row-delete-button ${pendingDeleteSender === sender.sender_email ? 'confirming' : ''}`}
                        type="button"
                        disabled={Boolean(deletingSender)}
                        aria-label={
                          pendingDeleteSender === sender.sender_email
                            ? `Confirm deleting local messages from ${sender.sender_email}`
                            : `Delete local messages from ${sender.sender_email}`
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          if (pendingDeleteSender === sender.sender_email) {
                            void deleteSender(sender);
                          } else {
                            setPendingDeleteSender(sender.sender_email);
                          }
                        }}
                      >
                        {deletingSender === sender.sender_email ? (
                          <LoaderCircle className="spin" size={13} />
                        ) : pendingDeleteSender === sender.sender_email ? 'Sure?' : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!loading && !result.rows.length ? (
                <tr><td colSpan={6} className="table-empty">No senders match this search.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={result.pageSize} total={result.total} onPage={setPage} />
      </section>
    </>
  );
}
