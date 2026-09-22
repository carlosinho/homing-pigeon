# Homing Pigeon architecture

This document describes the code that currently runs. Planned work is tracked in [ROADMAP.md](./ROADMAP.md).

## System design philosophy

Homing Pigeon is a local, single-process application optimized for a personal proof of concept rather than a hosted service. The React interface is a client of a loopback Express API. Express owns Google OAuth, Gmail API access, SQLite persistence, CSV generation, and an in-process background worker.

The central durability mechanism is idempotence, not precise workflow checkpointing. A Gmail message is stored at most once per account. If work is interrupted, Homing Pigeon restarts the Gmail query and skips rows already present instead of persisting and restoring Gmail page tokens.

The application intentionally stores a cumulative inventory. Fetch jobs record execution history and progress, but messages are not associated with the jobs that discovered them. This keeps ingestion and analysis simple at the cost of per-fetch result views.

```text
Browser
  React Router: /fetch, /messages, /senders, /domains
        │
        │ same-origin /api calls in a built deployment
        ▼
Express on 127.0.0.1
  ├── OAuth endpoints ─────────────── Google OAuth
  ├── background worker ───────────── Gmail API
  ├── query and CSV endpoints
  └── synchronous better-sqlite3 ─── .data/mailroom.db
```

In development, Vite serves the browser application on port 5173 and proxies `/api` to Express on port 3001. After `npm run build`, Express serves the generated `dist/` directory in addition to the API.

## Key invariants and rules

1. Every account is identified locally by `accounts.id`; Gmail addresses are unique case-insensitively.
2. Every stored message belongs to exactly one account through `messages.account_id`.
3. `(account_id, gmail_message_id)` is unique. Gmail IDs are never treated as globally unique across accounts.
4. Every fetch job belongs to one account, but there is no relationship between individual jobs and message rows.
5. Existing message rows are never refreshed during a fetch. A matching Gmail ID increments `skipped_count` and bypasses `messages.get`.
6. The Messages, Senders, and Domains APIs always query the cumulative inventory for an account, regardless of which query originally found a message.
7. Exactly one Gmail worker loop may be active. It processes queued fetch jobs serially across all accounts; classification has its own serial loop.
8. Gmail calls inside a job are sequential and share one process-wide minimum request delay.
9. The implementation requests headers, message-size estimates, and MIME metadata through a partial response that excludes body and attachment data.
10. Disconnecting an account removes local tokens but preserves its account row, messages, and fetch jobs.
11. The active account in the browser is a UI preference stored under `mailroom.activeAccount` in `localStorage`; it is not an authorization boundary.
12. Deleting an account's local messages preserves its account, OAuth tokens, and fetch jobs. With the message rows gone, a later fetch can import the same Gmail IDs again.
13. Row deletion is also local-only: a message action deletes one Gmail message ID, a sender action deletes one exact normalized sender group, and a domain action deletes one exact derived domain group.

## Startup sequence

Importing `server/src/database.ts` performs database initialization:

1. Create `.data/` relative to `process.cwd()` with requested mode `0700`.
2. Open `.data/mailroom.db` with `better-sqlite3` and request mode `0600` for the main file.
3. Enable WAL journal mode and SQLite foreign keys.
4. Run `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements.
5. Add missing `activity_events.target` and `messages.category` columns for older databases; create the unclassified-message index after adding the category column.
6. Change every fetch job still marked `running` to `queued` and attach the message `The app stopped before this fetch finished.`. Also requeue interrupted classification jobs.
7. Start Express on `127.0.0.1` using `PORT`.
8. Call `wakeWorker()`, which processes any recovered or previously queued fetch jobs. Resume queued classification jobs through a separate serial worker when a TypeSafe API key is configured.

There is no schema-version table or general migration runner. `CREATE TABLE IF NOT EXISTS` creates a fresh database but will not evolve older tables; the activity target and message category columns use explicit compatibility checks.

## Persistence model

### `accounts`

| Column | Meaning |
| --- | --- |
| `id` | Local integer primary key used by all account-scoped APIs and foreign keys. |
| `email` | Gmail address returned by `users.getProfile`; unique with `COLLATE NOCASE`. |
| `access_token` | Latest Google access token, nullable after disconnect. |
| `refresh_token` | Google refresh token, nullable when unavailable or disconnected. |
| `token_expiry` | Google token expiry in epoch milliseconds. |
| `token_scope` | Scope string returned by Google. |
| `created_at`, `updated_at` | SQLite UTC timestamps. |

OAuth credentials live on the account row so multiple Gmail accounts can coexist. Reconnecting an existing email updates that row rather than creating a duplicate. When Google refreshes credentials, the OAuth client's `tokens` event updates non-null token fields with `COALESCE`; a refresh response that omits a refresh token therefore does not erase the stored one.

### `fetch_jobs`

| Column | Meaning |
| --- | --- |
| `id` | Integer job identifier. |
| `account_id` | Owning account; foreign key with `ON DELETE CASCADE`. |
| `query` | Raw Gmail query submitted by the user. |
| `status` | Application state: `queued`, `running`, `completed`, or `failed`. The database does not enforce an enum constraint. |
| `total_estimate` | Larger of Gmail's latest `resultSizeEstimate` and the count discovered during the current attempt. It is an estimate, not an invariant. |
| `discovered_count` | IDs returned by `messages.list` during the current attempt. |
| `processed_count` | New rows handled during the current attempt. |
| `skipped_count` | Matching IDs that already existed during the current attempt. |
| `error` | Human-readable failure or recovery message. Cleared when processing starts. |
| `created_at`, `started_at`, `completed_at` | SQLite UTC timestamps. `started_at` is overwritten when a job runs again. |

The API reads the 20 newest jobs and 20 newest local-data events for the active account. The UI merges them chronologically and displays the 20 newest activity entries. Older rows remain in the database.

### `messages`

| Column | Meaning |
| --- | --- |
| `id` | Local integer primary key used as a deterministic secondary sort key. |
| `account_id` | Owning account; foreign key with `ON DELETE CASCADE`. |
| `sender_email` | Lowercased address extracted from `From`, or an empty string when absent. |
| `subject` | `Subject` header, or an empty string when absent. |
| `received_at` | Integer epoch milliseconds from Gmail `internalDate`; current wall-clock time is used only if Gmail omits it. |
| `rfc_message_id` | `Message-ID` with one leading `<` and trailing `>` removed, or an empty string. |
| `gmail_search` | `rfc822msgid:` plus the normalized RFC ID, or an empty string. |
| `gmail_message_id` | Gmail's internal message ID. |
| `gmail_thread_id` | Thread ID from `messages.get`, falling back to `messages.list`, then an empty string. |
| `size_bytes` | Gmail's estimated message size in bytes. |
| `attachment_count` | Number of MIME parts with filenames. |
| `attachment_bytes` | Combined reported size of those attachment parts. |
| `attachments_json` | Attachment filename, MIME type, and size metadata. |
| `created_at` | Time the local row was first inserted. |

Indexes support recent-job lookup, queued-job lookup, received-date ordering, sender grouping/filtering, and subject filtering. No index exists for RFC ID, Gmail search, or thread ID; Gmail message ID is covered by the composite unique constraint.

### `activity_events`

This table records successful destructive local-data actions without overloading fetch-job semantics. Each row belongs to an account and stores an event type, optional target, affected-item count, and creation time. `messages_deleted` represents a full inventory wipe, `message_deleted` one message, `sender_messages_deleted` one aggregated sender deletion, and `domain_messages_deleted` one aggregated domain deletion. Sender and domain events store the normalized sender or domain in `target`. These rows are retained when messages are erased and displayed with action-specific labels alongside fetch jobs in the Fetch screen's Activity list.

## OAuth and account flow

1. `GET /api/auth/google/start` verifies that both Google client variables exist.
2. The server creates 24 random bytes encoded as hex, stores the state value and a ten-minute expiry in a process-local `Map`, and returns a Google authorization URL.
3. The authorization request uses `access_type=offline`, `prompt=consent select_account`, and the single scope `https://www.googleapis.com/auth/gmail.readonly`.
4. Google redirects to `GET /api/auth/google/callback`.
5. The callback consumes the state exactly once. Missing, unknown, expired, or process-lost state redirects to `/fetch?authError=invalid_callback`.
6. The server exchanges the code for tokens, calls Gmail `users.getProfile`, and uses `emailAddress` to insert or update `accounts`.
7. The callback redirects to `APP_URL/fetch?connected=<local account id>`.
8. The React account context reloads account status and persists the active local account ID in `localStorage`.

OAuth state is deliberately in memory. Restarting the backend during the authorization round trip invalidates that attempt; starting Connect again creates a new one.

`POST /api/accounts/:accountId/disconnect` clears the four token fields. It does not call Google's token-revocation endpoint and does not delete local inventory.

## Fetch data flow

### Queueing

`POST /api/accounts/:accountId/jobs` validates `accountId` as a positive integer, verifies that the account row exists, and validates a trimmed query length of 1–1,000 characters. It inserts a `queued` job and calls `wakeWorker()`.

`wakeWorker()` is guarded by the module-level `workerActive` flag. If the worker is already active, the existing loop will pick up queued work. Otherwise it starts a loop that selects the oldest queued job by `created_at`, then `id`.

### Processing

For each job, the worker:

1. Loads the account and fails if both access and refresh tokens are absent.
2. Marks the job `running`, resets all counters, clears the old error and completion time, and replaces `started_at`.
3. Calls `users.messages.list` with the raw query, `userId: me`, and `maxResults: 500`.
4. Adds the returned page length to `discovered_count` and records the larger of that count and Gmail's latest result estimate.
5. Checks each returned Gmail ID against `(account_id, gmail_message_id)`.
6. For a known ID, increments `skipped_count` without contacting `messages.get`.
7. For a new ID, calls `users.messages.get` with `format: full` and a partial-response field mask that includes headers, size estimate, and nested MIME metadata while excluding body data.
8. Updates processed and skipped counters every ten handled IDs and at the end of every Gmail list page.
9. Follows `nextPageToken` until Gmail returns none.
10. Marks the job `completed` and writes its final counters and completion time.

The worker does not persist `nextPageToken`, the set of IDs in a page, or per-message work items. A process interruption therefore loses in-memory pagination progress. Startup recovery queues the job, and account-scoped message uniqueness makes replay safe.

Because existing messages are not refreshed, Homing Pigeon is a first-seen snapshot of those fields. A message deleted from Gmail remains in SQLite. A message that no longer matches a previous query also remains. Running a query again does not update its subject, sender, thread, or date.

## Job state transitions

```text
POST job
   │
   ▼
 queued ───────────────► running ───────────────► completed
   ▲                        │
   │                        └────────────────────► failed
   │                                                   │
   └──────── POST /api/jobs/:jobId/retry ──────────────┘

startup recovery: running ─► queued
```

Only a `failed` job can be retried through the API. There are no pause, cancel, or delete transitions. A retry reuses the same row and query; it does not create a new job.

## Gmail rate limiting and failure handling

All Gmail operations pass through `gmailRequest()`:

- A process-wide timestamp enforces at least `REQUEST_DELAY_MS` between request starts.
- The maximum number of attempts is seven, including the initial attempt.
- Retried errors are HTTP 429, all numeric 5xx responses, and HTTP 403 responses whose error text matches quota or rate-limit terms.
- Backoff is `min(64 seconds, 2^attempt × 1 second) + up to 1 second of jitter`.
- A numeric `Retry-After` response header is converted to milliseconds and wins when longer than the calculated backoff.
- Non-retryable errors and exhausted retries fail the complete job. Rows inserted before failure remain committed.

Authentication errors with status 401 or text matching `invalid_grant` or `unauthorized` are converted to a reconnect instruction. Other errors use Google's message when present. Invalid Gmail query errors are not retried and therefore fail the job.

SQLite operations are synchronous and message inserts are individually committed. There is no transaction spanning a Gmail page or job, which is why successful rows survive later request failures.

## Jev classification

Classification is manually triggered with `POST /api/accounts/:accountId/classification`. It snapshots the highest local ID and count of currently unclassified account messages into `classification_jobs`; a duplicate request while that account has queued/running classification returns 409. For page-only runs, the request includes the displayed Gmail `messageIds` (1–100); the API resolves only unclassified rows belonging to that account and persists their local IDs in `classification_jobs.message_ids_json`. The worker restricts processing to that saved selection, including after restart. An omitted selection means all unclassified account messages. Existing job tables receive the nullable selection column through an explicit compatibility check. No Gmail connection is required. New messages above the snapshot boundary wait for the next manual run.

`server/src/classification-worker.ts` runs one sequential classification loop across accounts, independently of the existing Gmail worker. It selects unclassified messages up to the job's maximum ID, sends sender and subject through `server/src/jev.ts`, and transactionally updates the existing message's nullable `category` and job progress. A partial index on `(account_id, id) WHERE category IS NULL` supports this selection. Updates never recreate deleted rows. Deletions can make the completed count smaller than the initial total.

Editable instructions and structured category definitions (`covers`, `not_for`, and sender/subject examples) live in `server/src/classification-guidance.ts`. The adapter includes them in every request. The Jev adapter uses the HTTP API with one Choice question and seven options: `newsletter`, `marketing`, `dev_update`, `travel`, `social_media`, `purchases`, and `other`. It validates the probability values and stores the option with the highest probability without a confidence threshold. Equal maxima use the first category in the declared order. Only sender and subject leave the app; there is no importance assessment. The key stays on the backend.

Requests time out after 30 seconds. HTTP 429/5xx responses get up to three attempts with bounded backoff and Retry-After handling; long cooldowns, authentication failures, transport failures, and invalid responses fail the job visibly. Previously saved results survive. A new manual run processes remaining unclassified messages. Startup changes interrupted `running` classification jobs to `queued`, preserving progress and the snapshot boundary. Classification results are not refreshed automatically.

`GET /api/accounts/:accountId/classification` returns whether Jev is configured, the account's unclassified count, and latest job. The frontend shows classification controls, notices, and category badges only after the status endpoint confirms that Jev is configured. Without a key, it uses the ordinary action-column width and hides even previously saved categories without deleting them. The CLASSIFY toggle beside More columns reveals page/all classification actions and a note explaining scope and data sent. The Messages screen polls this endpoint and refreshes visible rows as progress changes. Badges sit in the last column before the Gmail link. The message JSON and CSV expose `category`; category sorting/filtering is not added.

`DELETE /api/classifications` resets every non-null message category across every account with one SQLite update. It returns 409 if any classification job is queued or running, preventing pending Jev results from repopulating erased categories. It requires no Jev API key and preserves messages and job history. The UI places this action at the far right of the classification toolbar with inline two-click confirmation, then refreshes categories and status after success.

## Read and export APIs

The API is implemented directly in `server/src/index.ts`; there is no controller/service abstraction or version prefix beyond `/api`.

### Message queries

`buildMessageQuery()` constructs parameterized SQL scoped by `account_id`:

- `search` matches `sender_email` or `subject`.
- Each of the seven public columns can be a substring filter.
- `sender_domain` exactly matches the domain derived from `sender_email`; an empty value matches messages without a domain.
- `%`, `_`, and `\` in message filters are escaped and treated literally.
- `received_at` filtering converts the millisecond value to UTC with SQLite `strftime('%Y-%m-%d %H:%M:%S', ...)` before matching.
- `sortBy` is selected from a fixed column allowlist; invalid values fall back to `received_at`.
- Only case-insensitive text `asc` selects ascending order; every other `sortDir` becomes descending.
- `id DESC` is appended as a stable secondary order.
- Pages are one-based. `pageSize` defaults to 25 and is clamped to 10–100.

The list endpoint performs a count query and then an offset-based row query. The CSV endpoint uses the same filters and order but intentionally ignores pagination and iterates every matching row.

`DELETE /api/accounts/:accountId/messages` deletes the complete cumulative inventory for one account, regardless of active UI filters. It returns a conflict while that account has a queued or running fetch so the worker cannot repopulate the inventory during the deletion. The deletion and its activity event are committed in one SQLite transaction. Fetch history and OAuth credentials are preserved.

The related row-action endpoints delete one exact Gmail message ID, all rows for one exact normalized sender email, or all rows whose derived sender domain is an exact match. Unknown sender and domain groups are not exposed as deletion actions in the UI. These endpoints use the same active-fetch conflict rule and transactionally record one action-specific activity event with the affected row count. Sender and domain deletions create one aggregate event rather than one event per deleted message.

### Sender queries

Sender endpoints group by the stored `sender_email`; aliases are not merged beyond lowercase normalization. Search is a parameterized `LIKE` against `sender_email`, but unlike message filtering it does not escape `%` or `_`, so those characters act as SQL wildcard patterns.

Sender sorting allows `sender_email`, `message_count`, or combined `total_size_bytes`. Invalid values default to total size. The list endpoint uses count plus offset pagination; the CSV endpoint streams the complete filtered grouping.

### Domain queries

Domain endpoints derive the text after the first `@` in `sender_email`, grouping missing or malformed sender values under an empty domain displayed as Unknown domain. Search is a parameterized `LIKE` against the derived domain. Sorting allows only `sender_domain` or `message_count`; pagination and CSV streaming follow the Sender endpoints.

### CSV encoding

CSV responses are generated by Express without temporary files. They use CRLF line endings, a UTF-8 BOM, quoted cells, doubled embedded quotes, and a leading apostrophe for values beginning with spreadsheet formula characters. Message dates are converted from epoch milliseconds to ISO strings.

## Frontend architecture

React Router defines four routes under a shared `Layout`: `/fetch`, `/messages`, `/senders`, and `/domains`. Unknown routes and `/` redirect to `/fetch`.

The root `package.json` version is the application's version source of truth. The frontend imports it at build time and displays it in the shared layout footer, so changing the package version changes the version shown on every route after rebuilding or restarting the development server.

`AccountProvider` is the only shared client state. It loads `/api/auth/status`, chooses the previously selected account when possible, otherwise selects the first connected account or first known account, and exposes connect/disconnect actions. It does not use a client cache library.

The Fetch screen polls job history recursively with `setTimeout`: every 1.5 seconds while any of the 12 returned jobs is queued or running, otherwise every 5 seconds. Failed polls display an error and retry after 5 seconds; a successful poll clears that error. The Messages, Senders, and Domains screens debounce server reads by 220 milliseconds and ignore responses from superseded reads. Messages defaults to estimated size descending and shows attachment metadata; Senders defaults to combined estimated size.

The Senders-to-Messages drill-down is implemented as `/messages?sender_email=<address>`. The external-link action beside a sender opens Gmail in a new tab with a `from:<sender>` search and stops the surrounding row click from navigating locally. Domains uses `/messages?sender_domain=<domain>` and displays a removable active-domain indicator on the Messages screen. These query parameters are read when the component state is initialized. Message, sender, and domain row deletions require two clicks on the same inline button: the trash icon, then `Sure?`.

CSV downloads are ordinary links to the export endpoints, so the browser handles streaming and file naming.

Styling is a single hand-written stylesheet, `src/styles.css`, using semantic class names and a short reset at the top; there is no CSS framework or PostCSS configuration. The interface uses one typeface family in three widths: Routed Gothic regular, wide, and narrow are registered as `font-stretch` variants of the same family and self-hosted from `public/fonts`, and the stack lists a `Gorton` family first so a licensed Gorton Perfected can replace it by adding `@font-face` rules without other changes. Progress and sender volume share one visual device, a tick-mark scale whose filled width is proportional to the estimate or to the largest count on the current page.

## API validation and error semantics

- Express accepts JSON request bodies up to 32 KB.
- Zod validates positive integer path IDs and the job-creation body.
- Zod failures return HTTP 400 with the first issue message.
- Disconnect returns 404 for an unknown account.
- Job creation returns 404 for an unknown account.
- Retrying a job that is not failed returns 409.
- Unhandled errors are logged and returned as HTTP 500 with their message.
- Account-scoped read endpoints do not verify that the account exists; an unknown account ID normally produces an empty list or empty CSV.
- There is no explicit JSON 404 handler. In a built deployment, unmatched GET requests can fall through to the React `index.html` fallback.

## Security model

The primary boundary is the local machine:

- Express binds only to `127.0.0.1`.
- The app has no user login, session, API key, or per-request authorization layer.
- Any local process or browser context that can reach the loopback port can call its APIs, start jobs, disconnect accounts, and export stored data.
- Google client credentials come from `.env`; Gmail tokens and metadata are plaintext in SQLite.
- The data directory and main database file receive restrictive POSIX modes on a best-effort basis. The parent directory protection also covers SQLite WAL and shared-memory files.
- OAuth callback state is random, single-use, expires after ten minutes, and is not persisted.
- SQL values are parameterized. Sort column names are selected from allowlists before interpolation.
- React performs its normal text escaping for displayed headers and addresses.
- CSV cells receive formula-prefix protection.
- `x-powered-by` is disabled.

There is no explicit CSRF layer, origin validation, token encryption, OAuth grant revocation, audit logging, TLS, or secret manager integration. This is acceptable only for the intended loopback deployment. Changing the network binding without adding those controls would violate the current security assumptions.

## Performance decisions and constraints

### Decisions that support the current workload

- Gmail list pages use the maximum 500 IDs.
- Known messages avoid the expensive metadata request.
- SQLite WAL permits readers while the worker writes.
- Message views are paginated and filtered in SQL rather than loading the inventory into React.
- CSV results are iterated and written to the response instead of accumulated in memory.
- Indexes cover the default received-date order and the primary sender/subject analysis paths.

### Current scaling boundaries

- The worker is in the API process. Stopping or restarting the web server also stops active Gmail work.
- One global worker serializes all accounts, and the rate limiter is global rather than per account.
- Every new message requires an individual `messages.get`; the implementation does not use Gmail batch requests or controlled concurrency.
- Restarting a large job repeats all `messages.list` pages from the beginning.
- Offset pagination becomes increasingly expensive at deep page numbers.
- Substring `LIKE` search cannot use a full-text index and will scan more data as the inventory grows.
- Sender and domain counts are grouped on demand for both the page and total count. Domain grouping uses a computed expression and has no dedicated index.
- SQLite and plaintext local tokens make the design unsuitable for a horizontally scaled or multi-host deployment.
- `better-sqlite3` and the Express event loop share one process. Current SQL operations are short, but large scans or exports can delay other requests.

The schema and UI already support multiple Gmail accounts on one local installation. That is different from multi-user hosting: there are no user identities or authorization boundaries between those accounts.

## Edge cases and intentional exceptions

- Empty `From`, `Subject`, `Message-ID`, or thread values are stored as empty strings rather than rejecting the message.
- Sender parsing prefers text inside angle brackets, otherwise finds the first email-looking substring, otherwise stores the entire `From` value in lowercase. It does not implement the full RFC mailbox grammar or merge aliases.
- When `internalDate` is unexpectedly absent, ingestion uses `Date.now()`, so that row's received time is an ingestion-time fallback.
- A message without an RFC Message-ID has an empty `gmail_search`. The UI falls back to a generated Gmail query using subject and sender when opening it.
- Gmail's `resultSizeEstimate` can differ from the number ultimately discovered, so UI progress is approximate.
- A job that fails after partial ingestion may show different processed/skipped counts after retry because counters are reset while previously inserted messages become skips.
- Account disconnect does not interrupt an OAuth client already created for a running job; it only removes tokens from the database. Subsequent token refreshes or new jobs may then fail.
- The server does not validate that `REQUEST_DELAY_MS` is finite or non-negative. Operational configuration should provide a valid number.
- Changing `PORT` alone breaks the development proxy and normally the OAuth redirect; the related configuration must move together.

## Testing and maintenance

The automated suite contains focused parser tests plus minimal coverage for derived domain grouping and the empty-domain message filter. Run it with:

```bash
npm test
```

`npm run build` is also an important verification step because it type-checks the React application, bundles the frontend, and compiles the Node backend.

Focused classification tests cover probability selection, request contents, invalid responses, partial-failure retry, account/snapshot boundaries, and deletion during processing. There are no automated tests for OAuth, Gmail requests, retry timing, Gmail worker recovery, CSV output, Express routes, or browser behavior. Changes in those areas currently require targeted manual verification with a configured Google project or purpose-built test fixtures.

`legacy/code.gs` is retained as the behavior that motivated the app, but it is not imported, executed, or synchronized with the TypeScript implementation.

Dependency versions are recorded in `package-lock.json`. The backend and frontend share one root package rather than separate workspaces.
