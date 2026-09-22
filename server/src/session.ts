import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = 'mailroom.session';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginSchema = z.object({ password: z.string().min(1).max(1024) }).strict();

export function createSessionRouter(password: string, appUrl: string) {
  if (!password.trim()) {
    throw new Error('APP_PASSWORD is required. Set a non-empty password in .env.');
  }
  if (password.length > 1024) throw new Error('APP_PASSWORD must be at most 1024 characters.');

  const router = Router();
  const sessions = new Map<string, number>();
  const expectedPassword = createHash('sha256').update(password).digest();
  const origin = new URL(appUrl).origin;
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: new URL(appUrl).protocol === 'https:',
    path: '/api',
  };
  // One local user: a process-wide limit cannot be bypassed with forwarded IP headers.
  let failedAttempts = 0;
  let attemptWindowEnds = 0;

  function tokenFrom(request: Request) {
    return request.headers.cookie?.split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  }

  router.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const now = Date.now();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) sessions.delete(token);
    }
    const token = tokenFrom(request);
    if (token && sessions.has(token)) {
      response.locals.sessionId = token;
      response.locals.sessionExpiresAt = sessions.get(token);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.get('origin') !== origin) {
      response.status(403).json({ error: 'Request origin is not allowed.' });
      return;
    }
    next();
  });

  router.get('/health', (_request, response) => response.json({ ok: true }));
  router.get('/session', (_request, response) => {
    response.json({ authenticated: Boolean(response.locals.sessionId), expiresAt: response.locals.sessionExpiresAt ?? null });
  });
  router.post('/session/login', (request, response) => {
    const now = Date.now();
    if (now >= attemptWindowEnds) {
      failedAttempts = 0;
      attemptWindowEnds = now + LOGIN_WINDOW_MS;
    }
    if (failedAttempts >= 5) {
      response.setHeader('Retry-After', Math.ceil((attemptWindowEnds - now) / 1000));
      response.status(429).json({ error: 'Too many login attempts. Try again in a few minutes.' });
      return;
    }
    const body = loginSchema.safeParse(request.body);
    if (!body.success || !timingSafeEqual(
      createHash('sha256').update(body.data.password).digest(), expectedPassword,
    )) {
      failedAttempts += 1;
      response.status(401).json({ error: 'Incorrect password.' });
      return;
    }
    failedAttempts = 0;
    const previousToken = tokenFrom(request);
    if (previousToken) sessions.delete(previousToken);
    const token = randomBytes(32).toString('hex');
    const expiresAt = now + SESSION_DURATION_MS;
    sessions.set(token, expiresAt);
    response.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_DURATION_MS });
    response.json({ authenticated: true, expiresAt });
  });
  router.post('/session/logout', (request, response) => {
    const token = tokenFrom(request);
    if (token) sessions.delete(token);
    response.clearCookie(COOKIE_NAME, cookieOptions);
    response.status(204).end();
  });
  router.use((_request, response: Response, next) => {
    if (!response.locals.sessionId) {
      response.status(401).json({ error: 'Please log in.' });
      return;
    }
    next();
  });
  return router;
}
