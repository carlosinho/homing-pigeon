import { describe, expect, it } from 'vitest';
import { extractEmailAddress, normalizeMessageId } from '../src/parsers.js';

describe('extractEmailAddress', () => {
  it('extracts and normalizes an address from a named sender', () => {
    expect(extractEmailAddress('Ada Lovelace <ADA@example.com>')).toBe(
      'ada@example.com',
    );
  });

  it('accepts a bare address', () => {
    expect(extractEmailAddress('mailbox@example.org')).toBe(
      'mailbox@example.org',
    );
  });
});

describe('normalizeMessageId', () => {
  it('removes surrounding angle brackets', () => {
    expect(normalizeMessageId(' <message-id@example.com> ')).toBe(
      'message-id@example.com',
    );
  });
});
