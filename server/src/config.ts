import 'dotenv/config';
import { resolve } from 'node:path';

export const config = {
  port: Number(process.env.PORT || 3001),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ||
    'http://localhost:3001/api/auth/google/callback',
  requestDelayMs: Number(process.env.REQUEST_DELAY_MS || 300),
  typesafeApiKey: process.env.TYPESAFE_API_KEY || '',
  typesafeModel: process.env.TYPESAFE_MODEL || 'jev-latest',
  dataDirectory: resolve(process.cwd(), '.data'),
};

export const googleConfigured = Boolean(
  config.googleClientId && config.googleClientSecret,
);
