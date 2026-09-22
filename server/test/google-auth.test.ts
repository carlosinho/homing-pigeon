import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/config.js', () => ({
  googleConfigured: true,
  config: { googleClientId: 'test-client', googleClientSecret: 'test-secret', googleRedirectUri: 'http://localhost:3001/api/auth/google/callback' },
}));
vi.mock('../src/database.js', () => ({ db: {} }));
import { consumeOAuthState, createAuthorizationUrl } from '../src/google-auth.js';

afterEach(() => vi.restoreAllMocks());
const state = (session: string) => new URL(createAuthorizationUrl(session)).searchParams.get('state')!;

describe('OAuth session binding', () => {
  it('only consumes state for its initiating session and only once', () => {
    const valid = state('session-a');
    expect(consumeOAuthState(valid, 'session-a')).toBe(true);
    expect(consumeOAuthState(valid, 'session-a')).toBe(false);
    expect(consumeOAuthState(state('session-a'), 'session-b')).toBe(false);
  });
  it('rejects expired state', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const value = state('session-a');
    vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60 * 1000);
    expect(consumeOAuthState(value, 'session-a')).toBe(false);
  });
});
