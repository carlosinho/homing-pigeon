import { z } from 'zod';
import { config } from './config.js';
import { classificationQuestion, spamQuestion } from './classification-guidance.js';

export const categories = [
  'newsletter', 'marketing', 'dev_update', 'travel', 'social_media', 'purchases', 'other',
] as const;
export type Category = (typeof categories)[number];
export type ClassificationResult = { category: Category; probable_spam: boolean };

const spamThreshold = 0.7;

const probability = z.number().finite().min(0).max(1);
const responseSchema = z.object({
  answers: z.object({
    probable_spam: z.object({
      type: z.literal('noul'),
      noul: probability,
    }),
    category: z.object({
      type: z.literal('choice'),
      probabilities: z.object({
        newsletter: probability,
        marketing: probability,
        dev_update: probability,
        travel: probability,
        social_media: probability,
        purchases: probability,
        other: probability,
      }),
    }),
  }),
});

export function classificationFromResponse(payload: unknown): ClassificationResult {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Jev returned an invalid classification response.');
  const probabilities = parsed.data.answers.category.probabilities;
  const category = categories.reduce((best, category) =>
    probabilities[category] > probabilities[best] ? category : best,
  );
  return { category, probable_spam: parsed.data.answers.probable_spam.noul >= spamThreshold };
}

export async function classifyMessage(message: { sender_email: string; subject: string }): Promise<ClassificationResult> {
  if (!config.typesafeApiKey) throw new Error('Set TYPESAFE_API_KEY in .env and restart the server.');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.typesafeApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: config.typesafeModel,
        state: JSON.stringify({ sender: message.sender_email, subject: message.subject }),
        questions: {
          category: classificationQuestion,
          probable_spam: spamQuestion,
        },
      }),
    });
    if (response.ok) return classificationFromResponse(await response.json());
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 2) {
      throw new Error(`Jev request failed (HTTP ${response.status}). ${response.status === 401 || response.status === 403 ? 'Check TYPESAFE_API_KEY.' : 'Try classification again.'}`);
    }
    const retryAfter = response.headers.get('retry-after');
    const delay = retryAfter && Number.isFinite(Number(retryAfter))
      ? Number(retryAfter) * 1000
      : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
    // Leave long provider cooldowns to a manual retry instead of holding the worker.
    if (delay > 30_000) throw new Error('Jev is rate limited. Try classification again later.');
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000 * 2 ** attempt, delay || 0)));
  }
  throw new Error('Jev classification failed.');
}
