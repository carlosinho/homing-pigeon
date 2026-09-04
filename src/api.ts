import type { Account, FetchJob, Message, Page, Sender } from './types';

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

export function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const api = {
  authStatus: () =>
    request<{ configured: boolean; accounts: Account[] }>('/api/auth/status'),
  authorizationUrl: () => request<{ url: string }>('/api/auth/google/start'),
  disconnect: (accountId: number) =>
    request<void>(`/api/accounts/${accountId}/disconnect`, { method: 'POST' }),
  jobs: (accountId: number) =>
    request<{ jobs: FetchJob[] }>(`/api/accounts/${accountId}/jobs`),
  createJob: (accountId: number, query: string) =>
    request<FetchJob>(`/api/accounts/${accountId}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),
  retryJob: (jobId: number) =>
    request<FetchJob>(`/api/jobs/${jobId}/retry`, { method: 'POST' }),
  messages: (accountId: number, params: Record<string, string | number>) =>
    request<Page<Message>>(
      `/api/accounts/${accountId}/messages?${queryString(params)}`,
    ),
  senders: (accountId: number, params: Record<string, string | number>) =>
    request<Page<Sender>>(
      `/api/accounts/${accountId}/senders?${queryString(params)}`,
    ),
  messagesCsv: (accountId: number, params: Record<string, string | number>) =>
    `/api/accounts/${accountId}/messages.csv?${queryString(params)}`,
  sendersCsv: (accountId: number, params: Record<string, string | number>) =>
    `/api/accounts/${accountId}/senders.csv?${queryString(params)}`,
};
