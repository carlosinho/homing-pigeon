import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import { config, googleConfigured } from './config.js';
import { db, type AccountRecord } from './database.js';

const oauthStates = new Map<string, number>();
const TEN_MINUTES = 10 * 60 * 1000;

export function createOAuthClient(account?: AccountRecord) {
  if (!googleConfigured) {
    throw new Error('Google OAuth is not configured. Add credentials to .env.');
  }

  const client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  );

  if (account) {
    client.setCredentials({
      access_token: account.access_token || undefined,
      refresh_token: account.refresh_token || undefined,
      expiry_date: account.token_expiry || undefined,
      scope: account.token_scope || undefined,
    });

    client.on('tokens', (tokens) => {
      db.prepare(
        `UPDATE accounts
         SET access_token = COALESCE(?, access_token),
             refresh_token = COALESCE(?, refresh_token),
             token_expiry = COALESCE(?, token_expiry),
             token_scope = COALESCE(?, token_scope),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(
        tokens.access_token || null,
        tokens.refresh_token || null,
        tokens.expiry_date || null,
        tokens.scope || null,
        account.id,
      );
    });
  }

  return client;
}

export function createAuthorizationUrl(): string {
  const client = createOAuthClient();
  const state = randomBytes(24).toString('hex');
  oauthStates.set(state, Date.now() + TEN_MINUTES);

  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state,
  });
}

export function consumeOAuthState(state: string): boolean {
  const expiresAt = oauthStates.get(state);
  oauthStates.delete(state);
  return Boolean(expiresAt && expiresAt > Date.now());
}

export async function exchangeAuthorizationCode(code: string): Promise<number> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: client });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const email = profile.data.emailAddress;
  if (!email) throw new Error('Gmail did not return an account email address.');

  const existing = db
    .prepare('SELECT * FROM accounts WHERE email = ? COLLATE NOCASE')
    .get(email) as AccountRecord | undefined;

  if (existing) {
    db.prepare(
      `UPDATE accounts
       SET access_token = ?,
           refresh_token = COALESCE(?, refresh_token),
           token_expiry = ?,
           token_scope = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      tokens.access_token || null,
      tokens.refresh_token || null,
      tokens.expiry_date || null,
      tokens.scope || null,
      existing.id,
    );
    return existing.id;
  }

  const result = db
    .prepare(
      `INSERT INTO accounts
       (email, access_token, refresh_token, token_expiry, token_scope)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      email,
      tokens.access_token || null,
      tokens.refresh_token || null,
      tokens.expiry_date || null,
      tokens.scope || null,
    );

  return Number(result.lastInsertRowid);
}
