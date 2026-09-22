import type Database from 'better-sqlite3';
import type { ClassificationResult } from './jev.js';

type ClassificationMessage = { id: number; sender_email: string; subject: string };
type ClassificationJob = { id: number; account_id: number; max_message_id: number; message_ids_json: string | null };

// Jobs remain serial; each job overlaps up to four requests independently of Gmail ingestion.
export function createClassificationWorker(
  db: Database.Database,
  classify: (message: ClassificationMessage) => Promise<ClassificationResult>,
) {
  let active = false;
  return async function run() {
    if (active) return;
    active = true;
    try {
      while (true) {
        const job = db.prepare("SELECT * FROM classification_jobs WHERE status = 'queued' ORDER BY id LIMIT 1")
          .get() as ClassificationJob | undefined;
        if (!job) return;
        db.prepare("UPDATE classification_jobs SET status = 'running', error = NULL WHERE id = ?").run(job.id);
        try {
          let cursor = 0;
          let failed = false;
          let failure: unknown;
          const nextMessage = db.prepare(`SELECT id, sender_email, subject FROM messages
            WHERE account_id = ? AND id > ? AND id <= ? AND category IS NULL
            ${job.message_ids_json ? 'AND id IN (SELECT value FROM json_each(?))' : ''}
            ORDER BY id LIMIT 1`);
          const processMessages = async () => {
            try {
              while (!failed) {
                const message = nextMessage.get(job.account_id, cursor, job.max_message_id,
                  ...(job.message_ids_json ? [job.message_ids_json] : [])) as ClassificationMessage | undefined;
                if (!message) return;
                // Claim synchronously before awaiting so another slot cannot select this row.
                cursor = message.id;
                const classification = await classify(message);
                db.transaction(() => {
                  const result = db.prepare('UPDATE messages SET category = ?, probable_spam = ? WHERE id = ? AND account_id = ? AND category IS NULL')
                    .run(classification.category, Number(classification.probable_spam), message.id, job.account_id);
                  db.prepare('UPDATE classification_jobs SET processed_count = processed_count + ? WHERE id = ?')
                    .run(result.changes, job.id);
                })();
              }
            } catch (error) {
              if (!failed) failure = error;
              failed = true;
            }
          };
          // Drain every slot before changing job status or starting the next job.
          await Promise.all(Array.from({ length: 4 }, () => processMessages()));
          if (failed) throw failure;
          db.prepare("UPDATE classification_jobs SET status = 'completed' WHERE id = ?").run(job.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Classification failed. Try again.';
          db.prepare("UPDATE classification_jobs SET status = 'failed', error = ? WHERE id = ?").run(message, job.id);
        }
      }
    } finally {
      active = false;
    }
  };
}
