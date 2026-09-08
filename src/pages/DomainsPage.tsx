import { ArrowDown, ArrowUp, Download, LoaderCircle, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../account-context';
import { api } from '../api';
import { EmptyAccount } from '../components/EmptyAccount';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import type { Domain, Page } from '../types';

export function DomainsPage() {
  const { activeAccount, accounts } = useAccount();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'sender_domain' | 'message_count'>('message_count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Domain>>({ rows: [], total: 0, page: 1, pageSize: 25 });
  const [resultAccountId, setResultAccountId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingDeleteDomain, setPendingDeleteDomain] = useState('');
  const [deletingDomain, setDeletingDomain] = useState('');
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
    setPendingDeleteDomain('');
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api.domains(activeAccount.id, params);
        if (!active) return;
        setResult(result);
        setResultAccountId(activeAccount.id);
        setError('');
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not load domains.');
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

  const deleteDomain = async (domain: Domain) => {
    if (
      !activeAccount ||
      resultAccountId !== activeAccount.id ||
      deletingDomain ||
      !domain.sender_domain
    ) return;

    setDeletingDomain(domain.sender_domain);
    setError('');
    setNotice('');
    try {
      const { deletedCount } = await api.deleteDomain(
        activeAccount.id,
        domain.sender_domain,
      );
      setPendingDeleteDomain('');
      setPage(1);
      setReloadKey((current) => current + 1);
      setNotice(
        `${deletedCount.toLocaleString()} local ${deletedCount === 1 ? 'message' : 'messages'} deleted.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete local domain messages.');
    } finally {
      setDeletingDomain('');
    }
  };

  const toggleSort = (column: 'sender_domain' | 'message_count') => {
    if (sortBy === column) setSortDir((value) => (value === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(column);
      setSortDir(column === 'message_count' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const largest = result.rows.reduce((max, domain) => Math.max(max, domain.message_count), 0);

  if (!activeAccount && accounts.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Volume" title="Domains" description="See which domains send the most mail to your mailbox." />
        <EmptyAccount />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow=""
        title="Domains"
        description=""
        action={
          activeAccount && result.total > 0 ? (
            <a className="button" href={api.domainsCsv(activeAccount.id, params)}>
              <Download size={15} /> Export CSV
            </a>
          ) : null
        }
      />

      <section>
        <div className="sender-summary">
          <strong className="value">{result.total.toLocaleString()} unique domains</strong>
          <p>Each row is one domain, counted across every message fetched for this mailbox. Select a row to see its messages.</p>
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
              placeholder="Find a domain"
              aria-label="Find a domain"
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
                    className={sortBy === 'sender_domain' ? 'sorted' : ''}
                    onClick={() => toggleSort('sender_domain')}
                  >
                    Domain
                    {sortBy === 'sender_domain' ? sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
                  </button>
                </th>
                <th className="volume-column"><span className="sr-only">Share of the largest domain on this page</span></th>
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
              {result.rows.map((domain, index) => (
                <tr
                  key={domain.sender_domain || 'unknown-domain'}
                  className="clickable-row"
                  onClick={() => navigate(`/messages?sender_domain=${encodeURIComponent(domain.sender_domain)}`)}
                >
                  <td className="rank-column value">
                    {String((page - 1) * result.pageSize + index + 1).padStart(2, '0')}
                  </td>
                  <td className="sender-cell">{domain.sender_domain || 'Unknown domain'}</td>
                  <td className="volume-column">
                    <span
                      className="volume"
                      style={{ width: `${largest ? (domain.message_count / largest) * 100 : 0}%` }}
                      aria-hidden="true"
                    />
                  </td>
                  <td className="count-column value">{domain.message_count.toLocaleString()}</td>
                  <td className="row-delete-column" onClick={(event) => event.stopPropagation()}>
                    {domain.sender_domain && resultAccountId === activeAccount?.id ? (
                      <button
                        className={`row-delete-button ${pendingDeleteDomain === domain.sender_domain ? 'confirming' : ''}`}
                        type="button"
                        disabled={Boolean(deletingDomain)}
                        aria-label={
                          pendingDeleteDomain === domain.sender_domain
                            ? `Confirm deleting local messages from ${domain.sender_domain}`
                            : `Delete local messages from ${domain.sender_domain}`
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          if (pendingDeleteDomain === domain.sender_domain) {
                            void deleteDomain(domain);
                          } else {
                            setPendingDeleteDomain(domain.sender_domain);
                          }
                        }}
                      >
                        {deletingDomain === domain.sender_domain ? (
                          <LoaderCircle className="spin" size={13} />
                        ) : pendingDeleteDomain === domain.sender_domain ? 'Sure?' : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!loading && !result.rows.length ? (
                <tr><td colSpan={5} className="table-empty">No domains match this search.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={result.pageSize} total={result.total} onPage={setPage} />
      </section>
    </>
  );
}
