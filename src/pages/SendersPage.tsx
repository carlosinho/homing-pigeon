import { ArrowDown, ArrowUp, Download, Mail, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../account-context';
import { api } from '../api';
import { EmptyAccount } from '../components/EmptyAccount';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import type { Page, Sender } from '../types';

export function SendersPage() {
  const { activeAccount, accounts } = useAccount();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'sender_email' | 'message_count'>('message_count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Sender>>({ rows: [], total: 0, page: 1, pageSize: 25 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const params = useMemo(
    () => ({ search, sortBy, sortDir, page, pageSize: 25 }),
    [page, search, sortBy, sortDir],
  );

  useEffect(() => {
    if (!activeAccount) return;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        setResult(await api.senders(activeAccount.id, params));
        setError('');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load senders.');
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [activeAccount, params]);

  const toggleSort = (column: 'sender_email' | 'message_count') => {
    if (sortBy === column) setSortDir((value) => (value === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(column);
      setSortDir(column === 'message_count' ? 'desc' : 'asc');
    }
    setPage(1);
  };

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
        eyebrow="Volume"
        title="Senders"
        description="Rank senders by the number of messages in your local inventory."
        action={
          activeAccount ? (
            <a className="button button-secondary" href={api.sendersCsv(activeAccount.id, params)}>
              <Download size={16} /> Export CSV
            </a>
          ) : null
        }
      />

      <section className="sender-layout">
        <div className="sender-intro-card">
          <div className="sender-stamp"><Mail size={26} /></div>
          <p>Each row is one sender address, counted across every message fetched for this Gmail account.</p>
          <strong>{result.total.toLocaleString()} unique senders</strong>
        </div>

        <div className="table-card sender-table-card">
          <div className="table-toolbar">
            <label className="search-field">
              <Search size={17} />
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
          {error ? <div className="error-banner compact">{error}</div> : null}
          <div className={`table-scroll ${loading ? 'table-loading' : ''}`}>
            <table className="sender-table">
              <thead>
                <tr>
                  <th>
                    <button onClick={() => toggleSort('sender_email')}>
                      Sender
                      {sortBy === 'sender_email' ? sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : null}
                    </button>
                  </th>
                  <th className="count-column">
                    <button onClick={() => toggleSort('message_count')}>
                      Messages
                      {sortBy === 'message_count' ? sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : null}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((sender, index) => (
                  <tr
                    key={sender.sender_email || `unknown-${index}`}
                    className="clickable-row"
                    onClick={() => navigate(`/messages?sender_email=${encodeURIComponent(sender.sender_email)}`)}
                  >
                    <td>
                      <span className="sender-rank">{String((page - 1) * result.pageSize + index + 1).padStart(2, '0')}</span>
                      <strong>{sender.sender_email || 'Unknown sender'}</strong>
                    </td>
                    <td className="count-column">
                      <span className="count-pill">{sender.message_count.toLocaleString()}</span>
                    </td>
                  </tr>
                ))}
                {!loading && !result.rows.length ? (
                  <tr><td colSpan={2} className="table-empty">No senders match this search.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={result.pageSize} total={result.total} onPage={setPage} />
        </div>
      </section>
    </>
  );
}
