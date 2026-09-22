import { afterEach, describe, expect, it, vi } from 'vitest';
import { classificationFromResponse, classifyMessage } from '../src/jev.js';
import { config } from '../src/config.js';
import { classificationQuestion, spamQuestion } from '../src/classification-guidance.js';

const payload = {
  answers: {
    probable_spam: { type: 'noul', noul: 0.9 },
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
    expect(classificationFromResponse(payload)).toEqual({ category: 'dev_update', probable_spam: true });
    expect(classificationFromResponse({ answers: { probable_spam: { type: 'noul', noul: 0.2 }, category: {
      type: 'choice', probabilities: { newsletter: 0.15, marketing: 0.14, dev_update: 0.13, travel: 0.12, social_media: 0.12, purchases: 0.14, other: 0.2 },
    } } })).toEqual({ category: 'other', probable_spam: false });
  });

  it('rejects invalid provider results instead of saving Other for a failed request', () => {
    expect(() => classificationFromResponse({ answers: {} })).toThrow('invalid classification');
  });

  it.each([[0.6999, false], [0.7, true], [1, true], [0, false]])(
    'flags spam probability %s as %s', (noul, expected) => {
      const result = classificationFromResponse({
        answers: { ...payload.answers, probable_spam: { type: 'noul', noul } },
      });
      expect(result.probable_spam).toBe(expected);
    },
  );

  it.each([undefined, { type: 'noul', noul: 1.1 }, { type: 'noul', noul: -0.1 }, { type: 'noul', noul: '0.9' }])(
    'rejects missing or invalid spam answers', (probable_spam) => {
      expect(() => classificationFromResponse({ answers: { ...payload.answers, probable_spam } }))
        .toThrow('invalid classification');
    },
  );

  it('sends only sender and subject, with category and independent spam guidance', async () => {
    vi.spyOn(config, 'typesafeApiKey', 'get').mockReturnValue('test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetchMock);
    const message = { sender_email: 'bot@example.com', subject: 'Build failed', gmail_message_id: 'private-id' };
    expect(await classifyMessage(message)).toEqual({ category: 'dev_update', probable_spam: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.parse(body.state)).toEqual({ sender: message.sender_email, subject: message.subject });
    expect(Object.keys(body.questions)).toEqual(['category', 'probable_spam']);
    expect(Object.keys(body.questions.category.criteria)).toEqual(['newsletter', 'marketing', 'dev_update', 'travel', 'social_media', 'purchases', 'other']);
    expect(body.questions.category).toEqual(classificationQuestion);
    expect(body.questions.probable_spam).toEqual(spamQuestion);
  });
});
