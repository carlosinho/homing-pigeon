import { afterEach, describe, expect, it, vi } from 'vitest';
import { categoryFromResponse, classifyMessage } from '../src/jev.js';
import { config } from '../src/config.js';
import { classificationQuestion } from '../src/classification-guidance.js';

const payload = {
  answers: {
    category: {
      type: 'choice',
      choice: 'other',
      probabilities: { newsletter: 0.05, marketing: 0.1, dev_update: 0.7, travel: 0.05, social_media: 0.05, purchases: 0.03, other: 0.02 },
    },
  },
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Jev classification', () => {
  it('selects the highest probability, independent of choice or a confidence threshold', () => {
    expect(categoryFromResponse(payload)).toBe('dev_update');
    expect(categoryFromResponse({ answers: { category: {
      type: 'choice', probabilities: { newsletter: 0.15, marketing: 0.14, dev_update: 0.13, travel: 0.12, social_media: 0.12, purchases: 0.14, other: 0.2 },
    } } })).toBe('other');
  });

  it('rejects invalid provider results instead of saving Other for a failed request', () => {
    expect(() => categoryFromResponse({ answers: {} })).toThrow('invalid classification');
  });

  it('sends only sender and subject, with the seven category choices', async () => {
    vi.spyOn(config, 'typesafeApiKey', 'get').mockReturnValue('test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetchMock);
    const message = { sender_email: 'bot@example.com', subject: 'Build failed', gmail_message_id: 'private-id' };
    expect(await classifyMessage(message)).toBe('dev_update');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.parse(body.state)).toEqual({ sender: message.sender_email, subject: message.subject });
    expect(Object.keys(body.questions)).toEqual(['category']);
    expect(Object.keys(body.questions.category.criteria)).toEqual(['newsletter', 'marketing', 'dev_update', 'travel', 'social_media', 'purchases', 'other']);
    expect(body.questions.category).toEqual(classificationQuestion);
  });
});
