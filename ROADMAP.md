# Development roadmap

## Roadmap

### v0.1.0 — Working local POC

- [x] Local React and Express application — Vite serves development; Express serves the built UI and loopback API.
- [x] Google OAuth connection — Request read-only Gmail access and persist refreshed credentials in local SQLite.
- [x] Multiple Gmail accounts — Connect, select, reconnect, and disconnect accounts while retaining each account's inventory and history.
- [x] Gmail-query fetch jobs — Queue any validated Gmail search and enumerate matching messages in pages of up to 500.
- [x] Durable, idempotent ingestion — Uniqueness per account and Gmail message ID prevents duplicates; interrupted jobs requeue on startup.
- [x] Throttling and retries — Serialize Gmail calls, apply a configurable delay, and retry temporary quota or server failures with backoff.
- [x] Metadata-only inventory — Store sender, subject, dates, Gmail and RFC IDs, estimated size, and attachment metadata without bodies or files.
- [x] Fetch activity and retry UI — Show progress and recent history, surface failures, and allow failed jobs to be requeued.
- [x] Message browser — Provide server-side search, per-column filters, sorting, pagination, attachment details, and Gmail deep links.
- [x] Sender analysis — Rank normalized senders by message count and combined size, with drill-down to matching messages.
- [x] Domain analysis — Rank derived sender domains by message count, including unknown domains, with exact-filter drill-down.
- [x] Complete filtered CSV exports — Export message, sender, and domain results with stable sorting and spreadsheet-injection protection.
- [x] Account-scoped inventory erasure — Delete local message rows transactionally, preserve accounts and jobs, and record the activity.
- [x] Local data protections — Bind to loopback, exclude local secrets/data from Git, use restrictive POSIX modes, and validate API inputs.
- [x] Focused automated coverage — Test parsing helpers, domain grouping, and empty-domain message filtering with Vitest.

### v0.2.0 — Actual MVP

- [x] Simple delete button next to each row in the Messages, Senders, Domains screens.
  - The delete in Messages just deletes that given message from the app's database.
  - The delete in Senders deletes all messages from that specific sender from the app's database.
  - The delete in Domains deletes all messages from that specific domain name from the app's database.
  - Unknown sender and Unknown domain rows do not offer delete actions.
  - No sync with actual Gmail. This is just deleting from the app.
  - Simple confirmation UI: the trash button changes to "Sure?" and must be clicked again to delete.
- [x] Email classification with Jev
  - CLASSIFY beside More columns reveals actions to classify this page or all account messages, using sender and subject only and skipping existing categories.
  - Categories: newsletter, marketing, dev update, travel, social media junk, purchases, other.
  - Choose the category with the highest probability in Jev's response; no confidence threshold.
  - Display category badges immediately left of the Gmail external-link button and include categories in message CSV exports.
  - Editable category instructions and examples live in `server/src/classification-guidance.ts`.
- [x] Add version numbering with one source of truth.
- [x] Add simple user login.
  - Single-user password from required `APP_PASSWORD` in `.env`; no app user accounts.
  - Eight-hour in-memory sessions, invalidated on logout or restart; protected APIs and CSV exports.
  - Origin checks, login throttling, and session-bound Gmail OAuth. Deployment remains local-only.
  - The password remains plaintext in `.env`; login does not encrypt local data.
- [x] "Probable spam" suggestions
  - Assess spam independently in the same Jev request as category classification, using sender and subject only.
  - Keep the existing Classify this page / Classify all workflow and skip already categorized messages, including legacy rows without a spam assessment.
  - Editable spam guidance and examples share `server/src/classification-guidance.ts`; random-looking sender addresses are supporting evidence, not an automatic verdict.
  - Show only ☠️ beside the category when spam probability is at least 0.7, with “probably spam” on hover.
  - Include `probable_spam` in message CSV exports (1/0/blank); Erase classifications clears both categories and spam assessments.
- [x] Add privacy view
  - Footer toggle masks sender addresses in the Messages and Senders tables and standalone domains in the Domains table by covering contiguous middle chunks with solid bars using the locally hosted Redacted font.
  - Messages subjects use the same chunk redaction within words, preserving spaces and copyable text; full-subject hover tooltips are hidden while enabled.
- [x] Jev performance improvements
  - Process up to four Jev requests concurrently within one active job, saving each result immediately and draining outstanding requests before finalizing a failed job.
  - Refresh active classification status every 500 ms and update settled message views without the filter debounce.

### Backlog / future

- [ ] Gmail message actions — Add archive, label, trash, delete, or unsubscribe workflows with the required scope, confirmations, authorization, and audit trail.
- [ ] Fetch controls — Add pause and cancel behavior for queued and running jobs.
- [ ] Durable fetch checkpoints — Persist page cursors or per-message work so interrupted jobs resume near their last position.
- [ ] Large-search splitting — Automatically divide very large Gmail searches into date ranges.
- [ ] Inventory synchronization — Refresh stored metadata and remove local rows for Gmail deletions or messages that no longer match.
- [ ] Additional message metadata — Store fields such as labels, sender display names, and `List-Unsubscribe`.
- [ ] Higher-throughput ingestion — Evaluate batched metadata requests and controlled concurrency; add per-account scheduling and rate limits first.
- [ ] Durable multi-replica jobs — Move background work to an external queue before running multiple API replicas.
- [ ] Remote or multi-user deployment — Add authenticated ownership boundaries, encrypted credential separation, TLS, CSRF defenses, deliberate network binding, and monitoring.

## Known issues / tech debt

- Restart recovery replays a query from its first page because Gmail page tokens and per-message work are not persisted.
- One in-process worker and one process-wide rate limiter serialize all accounts; restarting the API also stops active Gmail work.
- New messages require individual `messages.get` calls; there is no batching or controlled concurrency.
- SQLite offset pagination, substring `LIKE` filters, and on-demand sender/domain grouping will become slower on large inventories.
- Sender and domain search treat `%` and `_` as SQL wildcards, unlike message column filters, which escape them.
- OAuth tokens are plaintext in SQLite and the app password is plaintext in `.env`; login protects API access, while operation remains intentionally loopback-only.
- OAuth state is process-local, so restarting the backend invalidates an authorization flow already in progress.
- Disconnecting an account does not stop an OAuth client already used by a running job; a later refresh may fail after tokens are cleared.
- Startup uses `CREATE TABLE IF NOT EXISTS` and has no general migration runner; the activity-event target and message category and spam columns have explicit compatibility upgrades.
- Account-scoped read routes return empty results for unknown account IDs, and unmatched built-deployment GET requests may return the React application instead of JSON 404.
- `REQUEST_DELAY_MS` is not checked for a finite, non-negative value.
- Automated tests cover parsers, minimal domain-query behavior, focused classification behavior, login sessions, and OAuth-state binding; most API, worker, OAuth, CSV, database, and browser behavior needs manual verification.

## Decisions pending

- TBD
