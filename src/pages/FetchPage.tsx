import {
  Check,
  Clock3,
  Link2,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount } from '../account-context';
import { api } from '../api';
import { EmptyAccount } from '../components/EmptyAccount';
import { PageHeader } from '../components/PageHeader';
import type { FetchJob } from '../types';

const queryExamples = [
  { label: 'Inbox older than a year', value: 'in:inbox older:1y' },
  {
    label: 'All received mail',
    value: 'in:anywhere -from:me -in:drafts -in:spam -in:trash',
  },
  {
    label: 'A specific year',
    value: 'in:inbox after:2025/01/01 before:2026/01/01',
  },
];

function statusLabel(status: FetchJob['status']) {
  return {
    queued: 'Queued',
    running: 'Fetching',
    completed: 'Complete',
    failed: 'Needs attention',
  }[status];
}

export function FetchPage() {
  const {
    activeAccount,
    accounts,
    configured,
    connect,
    disconnect,
    selectAccount,
    refresh,
  } = useAccount();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [jobs, setJobs] = useState<FetchJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const connected = Number(searchParams.get('connected'));
    if (connected) {
      selectAccount(connected);
      void refresh();
      setSearchParams({}, { replace: true });
    }
    const authError = searchParams.get('authError');
    if (authError) setError(authError.replaceAll('_', ' '));
  }, [refresh, searchParams, selectAccount, setSearchParams]);

  useEffect(() => {
    if (!activeAccount) {
      setJobs([]);
      return;
    }

    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const result = await api.jobs(activeAccount.id);
        if (!active) return;
        setJobs(result.jobs);
        const unfinished = result.jobs.some(
          (job) => job.status === 'queued' || job.status === 'running',
        );
        timer = window.setTimeout(load, unfinished ? 1_500 : 5_000);
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not load fetches.');
        }
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeAccount]);

  const activeJob = useMemo(
    () => jobs.find((job) => job.status === 'running' || job.status === 'queued'),
    [jobs],
  );
  const progress = activeJob
    ? Math.min(
        100,
        Math.round(
          ((activeJob.processed_count + activeJob.skipped_count) /
            Math.max(activeJob.total_estimate, activeJob.discovered_count, 1)) *
            100,
        ),
      )
    : 0;

  const startFetch = async () => {
    if (!activeAccount || !query.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const job = await api.createJob(activeAccount.id, query.trim());
      setJobs((current) => [job, ...current]);
      setQuery('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the fetch.');
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async (jobId: number) => {
    try {
      const job = await api.retryJob(jobId);
      setJobs((current) => current.map((item) => (item.id === job.id ? job : item)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not retry the fetch.');
    }
  };

  if (!activeAccount && accounts.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Intake"
          title="Fetch mail"
          description="Run a Gmail search in the background and build a private local inventory."
        />
        <EmptyAccount />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Intake"
        title="Fetch mail"
        description="Run a Gmail search in the background. You can close this tab while Mailroom keeps working."
      />

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="connection-strip">
        <div className={`connection-signal ${activeAccount?.connected ? 'connected' : ''}`}>
          {activeAccount?.connected ? <Check size={16} /> : <Link2 size={16} />}
        </div>
        <div>
          <span className="connection-kicker">Gmail connection</span>
          <strong>{activeAccount?.email}</strong>
        </div>
        <span className={`status-chip ${activeAccount?.connected ? 'success' : 'warning'}`}>
          {activeAccount?.connected ? 'Connected' : 'Disconnected'}
        </span>
        <div className="connection-actions">
          {activeAccount?.connected ? (
            <button className="text-button muted" onClick={() => void disconnect()}>
              Disconnect
            </button>
          ) : configured ? (
            <button className="button button-secondary" onClick={() => void connect()}>
              Reconnect
            </button>
          ) : null}
        </div>
      </section>

      <div className="fetch-grid">
        <section className="card query-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">New route</p>
              <h2>Choose what to fetch</h2>
            </div>
            <ShieldCheck size={20} className="muted-icon" />
          </div>
          <label className="field-label" htmlFor="gmail-query">
            Gmail search query
          </label>
          <textarea
            id="gmail-query"
            rows={4}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="in:inbox older:1y"
            disabled={!activeAccount?.connected}
          />
          <div className="query-examples">
            {queryExamples.map((example) => (
              <button
                key={example.label}
                onClick={() => setQuery(example.value)}
                disabled={!activeAccount?.connected}
              >
                {example.label}
              </button>
            ))}
          </div>
          <button
            className="button button-primary fetch-button"
            disabled={!query.trim() || submitting || !activeAccount?.connected}
            onClick={() => void startFetch()}
          >
            {submitting ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
            Start fetch
          </button>
        </section>

        <section className="card progress-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Current route</p>
              <h2>{activeJob ? statusLabel(activeJob.status) : 'Ready'}</h2>
            </div>
            {activeJob ? <LoaderCircle className="spin cobalt-icon" size={21} /> : <Check size={21} />}
          </div>
          {activeJob ? (
            <>
              <p className="active-query">{activeJob.query}</p>
              <div className="progress-track" aria-label={`${progress}% complete`}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-stats">
                <div>
                  <strong>{activeJob.processed_count.toLocaleString()}</strong>
                  <span>added</span>
                </div>
                <div>
                  <strong>{activeJob.skipped_count.toLocaleString()}</strong>
                  <span>already stored</span>
                </div>
                <div>
                  <strong>{activeJob.total_estimate.toLocaleString()}</strong>
                  <span>estimated</span>
                </div>
              </div>
            </>
          ) : (
            <div className="ready-state">
              <div className="ready-ring"><Clock3 size={23} /></div>
              <p>No fetch is running.</p>
              <span>Start one on the left; progress will appear here.</span>
            </div>
          )}
        </section>
      </div>

      <section className="history-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Dispatch log</p>
            <h2>Recent fetches</h2>
          </div>
        </div>
        <div className="history-list">
          {jobs.length ? (
            jobs.map((job) => (
              <article className="history-row" key={job.id}>
                <span className={`job-dot ${job.status}`} />
                <div className="history-query">
                  <strong>{job.query}</strong>
                  <span>{new Date(`${job.created_at}Z`).toLocaleString()}</span>
                </div>
                <span className={`status-chip ${job.status}`}>{statusLabel(job.status)}</span>
                <span className="history-count">
                  {job.processed_count.toLocaleString()} added
                </span>
                {job.status === 'failed' ? (
                  <button className="icon-text-button" onClick={() => void retry(job.id)}>
                    <RefreshCw size={14} /> Retry
                  </button>
                ) : null}
                {job.error ? <p className="job-error">{job.error}</p> : null}
              </article>
            ))
          ) : (
            <div className="inline-empty">Your completed fetches will appear here.</div>
          )}
        </div>
      </section>
    </>
  );
}
