import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionRouter, SESSION_DURATION_MS } from '../src/session.js';

const origin = 'http://localhost:5173';
let server: Server;
let base: string;

beforeEach(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createSessionRouter('private test password', origin));
  app.get('/api/accounts/1/messages.csv', (_request, response) => response.send('csv'));
  app.get('/api/auth/status', (_request, response) => response.json({ accounts: [] }));
  app.post('/api/accounts/1/jobs', (_request, response) => response.status(201).end());
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  base = `http://127.0.0.1:${address.port}/api`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function login(password = 'private test password') {
  return fetch(`${base}/session/login`, {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}
function cookie(response: Response) {
  return response.headers.get('set-cookie')!.split(';')[0];
}

describe('local password sessions', () => {
  it('requires a configured password', () => {
    expect(() => createSessionRouter('', origin)).toThrow('APP_PASSWORD is required');
    expect(() => createSessionRouter('  ', origin)).toThrow('APP_PASSWORD is required');
  });

  it('protects account data, exports, and mutations while allowing session status', async () => {
    for (const path of ['/auth/status', '/accounts/1/messages.csv']) {
      expect((await fetch(base + path)).status).toBe(401);
    }
    expect((await fetch(`${base}/accounts/1/jobs`, { method: 'POST', headers: { origin } })).status).toBe(401);
    expect(await (await fetch(`${base}/session`)).json()).toEqual({ authenticated: false, expiresAt: null });
  });

  it('logs in, sends a private cookie, and revokes the session on logout', async () => {
    expect((await login('wrong')).status).toBe(401);
    const response = await login();
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    const headers = { cookie: cookie(response), origin };
    const data = await fetch(`${base}/accounts/1/messages.csv`, { headers });
    expect(data.status).toBe(200);
    expect(data.headers.get('cache-control')).toBe('no-store');
    expect((await fetch(`${base}/session/logout`, { method: 'POST', headers })).status).toBe(204);
    expect((await fetch(`${base}/auth/status`, { headers })).status).toBe(401);
  });

  it('expires a session after eight hours', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const headers = { cookie: cookie(await login()) };
    vi.spyOn(Date, 'now').mockReturnValue(now + SESSION_DURATION_MS);
    expect((await fetch(`${base}/auth/status`, { headers })).status).toBe(401);
  });

  it('does not share sessions with a new server instance', async () => {
    const headers = { cookie: cookie(await login()) };
    const app = express();
    app.use('/api', createSessionRouter('private test password', origin));
    const fresh = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const address = fresh.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/session`, { headers });
      expect(await response.json()).toEqual({ authenticated: false, expiresAt: null });
    } finally {
      await new Promise<void>((resolve) => fresh.close(() => resolve()));
    }
  });

  it('rejects cross-origin login and authenticated mutations', async () => {
    expect((await fetch(`${base}/session/login`, { method: 'POST', headers: { origin: 'https://example.com' } })).status).toBe(403);
    const headers = { cookie: cookie(await login()), origin: 'https://example.com' };
    expect((await fetch(`${base}/accounts/1/jobs`, { method: 'POST', headers })).status).toBe(403);
  });

  it('throttles repeated bad passwords and allows retry after the window', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    for (let index = 0; index < 5; index += 1) expect((await login('wrong')).status).toBe(401);
    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('900');
    vi.spyOn(Date, 'now').mockReturnValue(now + 15 * 60 * 1000);
    expect((await login()).status).toBe(200);
  });
});
