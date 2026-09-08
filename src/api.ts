import type {
  Account,
  ActivityEvent,
  Domain,
  FetchJob,
  MessagePage,
  Page,
  Sender,
} from './types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error || `Request failed (${response.status}).`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function queryString(
  values: Record<string, string | number | undefined>,
  includeEmpty: string[] = [],
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && (value !== '' || includeEmpty.includes(key))) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export const api = {
  authStatus: () =>
    request<{ configured: boolean; accounts: Account[] }>('/api/auth/status'),
  authorizationUrl: () => request<{ url: string }>('/api/auth/google/start'),
  disconnect: (accountId: number) =>
    request<void>(`/api/accounts/${accountId}/disconnect`, { method: 'POST' }),
  deleteMessages: (accountId: number) =>
    request<{ deletedCount: number }>(`/api/accounts/${accountId}/messages`, {
      method: 'DELETE',
    }),
  deleteMessage: (accountId: number, gmailMessageId: string) =>
    request<{ deletedCount: number }>(
      `/api/accounts/${accountId}/messages/${encodeURIComponent(gmailMessageId)}`,
      { method: 'DELETE' },
    ),
  deleteSender: (accountId: number, senderEmail: string) =>
    request<{ deletedCount: number }>(`/api/accounts/${accountId}/senders`, {
      method: 'DELETE',
      body: JSON.stringify({ senderEmail }),
    }),
  deleteDomain: (accountId: number, senderDomain: string) =>
    request<{ deletedCount: number }>(`/api/accounts/${accountId}/domains`, {
      method: 'DELETE',
      body: JSON.stringify({ senderDomain }),
    }),
  jobs: (accountId: number) =>
    request<{ jobs: FetchJob[]; activities: ActivityEvent[] }>(
      `/api/accounts/${accountId}/jobs`,
    ),
  createJob: (accountId: number, query: string) =>
    request<FetchJob>(`/api/accounts/${accountId}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),
  retryJob: (jobId: number) =>
    request<FetchJob>(`/api/jobs/${jobId}/retry`, { method: 'POST' }),
  messages: (accountId: number, params: Record<string, string | number | undefined>) =>
    request<MessagePage>(
      `/api/accounts/${accountId}/messages?${queryString(params, ['sender_domain'])}`,
    ),
  senders: (accountId: number, params: Record<string, string | number>) =>
    request<Page<Sender>>(
      `/api/accounts/${accountId}/senders?${queryString(params)}`,
    ),
  domains: (accountId: number, params: Record<string, string | number>) =>
    request<Page<Domain>>(
      `/api/accounts/${accountId}/domains?${queryString(params)}`,
    ),
  messagesCsv: (accountId: number, params: Record<string, string | number | undefined>) =>
    `/api/accounts/${accountId}/messages.csv?${queryString(params, ['sender_domain'])}`,
  sendersCsv: (accountId: number, params: Record<string, string | number>) =>
    `/api/accounts/${accountId}/senders.csv?${queryString(params)}`,
  domainsCsv: (accountId: number, params: Record<string, string | number>) =>
    `/api/accounts/${accountId}/domains.csv?${queryString(params)}`,
};
