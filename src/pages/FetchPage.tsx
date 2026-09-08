import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount } from '../account-context';
import { api } from '../api';
import { EmptyAccount } from '../components/EmptyAccount';
import { PageHeader } from '../components/PageHeader';
import type { ActivityEvent, FetchJob } from '../types';

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

function activityLabel(event: ActivityEvent) {
  switch (event.event_type) {
    case 'message_deleted':
      return { title: 'Local message deleted', status: 'Delete' };
    case 'sender_messages_deleted':
      return {
        title: `All messages from ${event.target} deleted`,
        status: 'Sender',
      };
    case 'domain_messages_deleted':
      return {
        title: `All messages from domain ${event.target} deleted`,
        status: 'Domain',
      };
    default:
      return { title: 'Local message inventory erased', status: 'Erase' };
  }
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
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');

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
    setPollError('');
    if (!activeAccount) {
      setJobs([]);
      setActivities([]);
      return;
    }

    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const result = await api.jobs(activeAccount.id);
        if (!active) return;
        setJobs(result.jobs);
        setActivities(result.activities);
        setPollError('');
        const unfinished = result.jobs.some(
          (job) => job.status === 'queued' || job.status === 'running',
        );
        timer = window.setTimeout(load, unfinished ? 1_500 : 5_000);
      } catch (caught) {
        if (active) {
          setPollError(caught instanceof Error ? caught.message : 'Could not load fetches.');
          timer = window.setTimeout(load, 5_000);
        }
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeAccount]);

  const activeJob = jobs.find(
    (job) => job.status === 'running' || job.status === 'queued',
  );
  const effectiveEstimate = activeJob
    ? Math.max(activeJob.total_estimate, activeJob.discovered_count)
    : 0;
  const progress = activeJob
    ? Math.min(
        100,
        Math.round(
          ((activeJob.processed_count + activeJob.skipped_count) /
            Math.max(effectiveEstimate, 1)) *
            100,
        ),
      )
    : 0;
  const activity = [
    ...jobs.map((job) => ({ kind: 'fetch' as const, item: job })),
    ...activities.map((event) => ({ kind: 'event' as const, item: event })),
  ]
    .sort((left, right) => right.item.created_at.localeCompare(left.item.created_at))
    .slice(0, 12);

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
          eyebrow=""
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
        eyebrow=""
        title="Fetch from gmail"
        description=""
        action={
          activeAccount ? (
            <div className="connection-summary">
              <div className="connection-mailbox">
                <span className="plate">Mailbox</span>
                <strong>{activeAccount.email}</strong>
              </div>
              <span className={`status ${activeAccount.connected ? 'connected' : 'disconnected'}`}>
                {activeAccount.connected ? 'Connected' : 'Disconnected'}
              </span>
              {activeAccount.connected ? (
                <button className="text-button" onClick={() => void disconnect()}>
                  Disconnect
                </button>
              ) : configured ? (
                <button className="button" onClick={() => void connect()}>
                  Reconnect
                </button>
              ) : null}
            </div>
          ) : null
        }
      />

      {error ? <div className="error-banner">{error}</div> : null}
      {pollError ? <div className="error-banner" role="alert">{pollError}</div> : null}

      <div className="fetch-grid">
        <section>
          <label className="plate field-label" htmlFor="gmail-query">
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
            {submitting ? <LoaderCircle className="spin" size={16} /> : null}
            Start fetch
          </button>
        </section>

        <section aria-live="polite">
          <div className="current-title">
            <p className="plate">Current fetch</p>
            {activeJob ? (
              <span className={`status ${activeJob.status}`}>{statusLabel(activeJob.status)}</span>
            ) : null}
          </div>
          {activeJob ? (
            <>
              <p className="current-query value">{activeJob.query}</p>
              <div
                className={`meter ${activeJob.status === 'running' ? 'live' : ''}`}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="meter-readout value">
                <span>
                  <strong>{progress}%</strong> of estimate
                </span>
                <span>
                  {(activeJob.processed_count + activeJob.skipped_count).toLocaleString()} /{' '}
                  {effectiveEstimate.toLocaleString()}
                </span>
              </div>
              <div className="progress-stats value">
                <div>
                  <strong>{activeJob.processed_count.toLocaleString()}</strong>
                  <span>added</span>
                </div>
                <div>
                  <strong>{activeJob.skipped_count.toLocaleString()}</strong>
                  <span>duplicate</span>
                </div>
                <div>
                  <strong>{effectiveEstimate.toLocaleString()}</strong>
                  <span>estimated</span>
                </div>
              </div>
            </>
          ) : (
            <p className="ready-state">
              No fetch is running.
              <span>Start one from the query box. Progress appears here and keeps going if you close the tab.</span>
            </p>
          )}
        </section>
      </div>

      <section>
        <p className="plate">Activity</p>
        <div className="history-list">
          {activity.length ? (
            activity.map((entry) => {
              if (entry.kind === 'event') {
                const event = entry.item;
                const label = activityLabel(event);
                return (
                  <article className="history-row" key={`event-${event.id}`}>
                    <div className="history-query">
                      <strong className="value" title={label.title}>{label.title}</strong>
                      <span className="value">{new Date(`${event.created_at}Z`).toLocaleString()}</span>
                    </div>
                    <span className="status completed">{label.status}</span>
                    <span className="history-count value">
                      {event.item_count.toLocaleString()} deleted
                    </span>
                    <span />
                  </article>
                );
              }

              const job = entry.item;
              return (
                <article className="history-row" key={`fetch-${job.id}`}>
                  <div className="history-query">
                    <strong className="value">{job.query}</strong>
                    <span className="value">{new Date(`${job.created_at}Z`).toLocaleString()}</span>
                  </div>
                  <span className={`status ${job.status}`}>{statusLabel(job.status)}</span>
                  <span className="history-count value">
                    {job.processed_count.toLocaleString()} added
                  </span>
                  {job.status === 'failed' ? (
                    <button className="icon-text-button history-retry" onClick={() => void retry(job.id)}>
                      <RefreshCw size={13} /> Retry
                    </button>
                  ) : (
                    <span />
                  )}
                  {job.error ? <p className="job-error">{job.error}</p> : null}
                </article>
              );
            })
          ) : (
            <div className="inline-empty">Fetches and local data changes will appear here.</div>
          )}
        </div>
      </section>
    </>
  );
}
