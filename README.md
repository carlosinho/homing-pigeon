# Mailroom

Mailroom is a local Gmail inventory for answering a practical cleanup question: which senders account for most of the mail in an account? It replaces the original `code.gs` spreadsheet export with a browser interface, a background fetch process, local persistence, and CSV exports.

Mailroom is read-only. It does not archive, label, trash, delete, or unsubscribe from messages.

## What it does

Mailroom runs the same search syntax as the Gmail search box and stores one row for each matching Gmail message. The stored fields are:

- `sender_email`, extracted from the `From` header and normalized to lowercase
- `subject`
- `received_at`, taken from Gmail's `internalDate`
- `rfc_message_id`, taken from the `Message-ID` header with surrounding angle brackets removed
- `gmail_search`, generated as `rfc822msgid:<id>` when an RFC Message-ID is available
- `gmail_message_id`
- `gmail_thread_id`

The app requests message metadata, not message bodies or attachments. Repeating or overlapping searches does not create duplicate rows because messages are unique by Gmail account and Gmail message ID.

The inventory is cumulative for each account. A completed fetch adds new messages to that account's existing inventory; the Messages and Senders screens are not limited to the results of one particular fetch.

## Main flows

### 1. Connect Gmail

The Fetch screen starts Google OAuth and records the connected Gmail address and tokens locally. More than one account can be connected, and the mailbox selector in the top bar controls which account the screens use.

Disconnecting an account clears its OAuth tokens but deliberately leaves its fetched messages and job history in SQLite. A disconnected account can still be browsed and exported; it must be reconnected before another fetch can run.

### 2. Fetch messages

Enter any Gmail query on the Fetch screen, such as:

```text
in:inbox older:1y
```

```text
in:anywhere -from:me -in:drafts -in:spam -in:trash
```

The backend lists matching Gmail messages in pages of up to 500, fetches the three required headers plus Gmail metadata for each new message, and records progress in SQLite. The browser can be closed while a fetch runs, but the Node process must remain running.

Only one fetch is processed at a time across all connected accounts. Gmail requests are sequential and throttled by `REQUEST_DELAY_MS`. Temporary quota and server errors are retried with exponential backoff.

If the process stops during a fetch, that job is returned to the queue on the next startup. It starts its Gmail query again from the first page and skips messages already stored. It does not resume from a saved Gmail page token.

### 3. Browse messages

The Messages screen provides server-side pagination, sorting on every stored field, sender/subject search, and per-column substring filters. The external-link action opens a Gmail search for the selected message.

The received-date filter is matched against a UTC `YYYY-MM-DD HH:MM:SS` representation in SQLite, while dates displayed in the browser use the browser's local timezone.

### 4. Rank senders

The Senders screen groups the current account's stored messages by normalized sender email. It defaults to the highest message count first. Selecting a sender opens the Messages screen with that sender filter applied.

### 5. Export CSV

Both data screens export all rows matching the active account, filters, search, and sort order; exports are not limited to the visible page. Message CSV files contain the seven stored fields, with `received_at` formatted as an ISO timestamp. Sender CSV files contain `sender_email` and `message_count`.

CSV output includes a UTF-8 BOM, quotes every value, and prefixes cells beginning with `=`, `+`, `-`, or `@` to reduce spreadsheet formula-injection risk.

## Tech stack

- React 18, React Router, TypeScript, and Vite
- Hand-written CSS in `src/styles.css`, with no CSS framework
- Routed Gothic, a self-hosted open-licence Gorton typeface, in `public/fonts`
- Express 5 and TypeScript for the local API
- `googleapis` for OAuth and Gmail API access
- SQLite through `better-sqlite3`
- Zod for request validation
- Vitest for the current parser tests

## Requirements

- Node.js 22 or newer
- A Google Cloud project
- Gmail API enabled in that project
- OAuth credentials that allow the Gmail account you intend to connect

## Google OAuth setup

For Google Cloud setup instructions read `GoogleOAuth.md`

## Configuration

`.env` is loaded by the backend through `dotenv`.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Yes | none | OAuth client ID from Google Cloud. OAuth is reported as unconfigured without it. |
| `GOOGLE_CLIENT_SECRET` | Yes | none | OAuth client secret from Google Cloud. OAuth is reported as unconfigured without it. |
| `GOOGLE_REDIRECT_URI` | No | `http://localhost:3001/api/auth/google/callback` | OAuth callback URL. It must exactly match an authorized redirect URI in Google Cloud. |
| `APP_URL` | No | `http://localhost:5173` | Frontend URL used after the OAuth callback. Use the default for development and `http://localhost:3001` for a built local deployment. |
| `PORT` | No | `3001` | Express port. The server always binds to `127.0.0.1`. The Vite development proxy is statically configured for port 3001, so changing this also requires changing `vite.config.ts`. |
| `REQUEST_DELAY_MS` | No | `300` | Minimum delay between Gmail API requests, shared by all accounts and jobs. Use a non-negative number. |

The SQLite location is not configurable: it is `.data/mailroom.db` relative to the directory from which the backend is started.

## Install and run in development

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). `npm run dev` starts the Vite frontend and the watched TypeScript backend together. Vite proxies `/api` to `http://localhost:3001`.

The available npm commands are:

| Command | Effect |
| --- | --- |
| `npm run dev` | Run Vite and the backend in watch mode. |
| `npm run dev:client` | Run only Vite. |
| `npm run dev:server` | Run only the backend through `tsx watch`. |
| `npm run build` | Type-check the frontend, build it into `dist/`, and compile the backend into `server/dist/`. |
| `npm start` | Run the compiled backend, which also serves `dist/` when it exists. |
| `npm test` | Run the Vitest suite once. |

## Build and run as a local deployment

The implemented deployment target is one user running the application on the same computer as the browser. It is not prepared for public or shared hosting.

Set the production-style frontend URL in `.env`:

```text
APP_URL=http://localhost:3001
```

Then build and start:

```bash
npm run build
npm start
```

Open [http://localhost:3001](http://localhost:3001). The Express process serves the compiled React application and API from the same loopback origin.

If the port or hostname changes, update `PORT`, `APP_URL`, `GOOGLE_REDIRECT_URI`, and the authorized redirect URI in Google Cloud together. Remote deployment would additionally require an application authentication layer, TLS, CSRF protection, different token storage, and a deliberate network binding; those are not implemented.

## Local data and reset

The backend creates `.data/mailroom.db`, enables SQLite WAL mode, and stores message metadata, fetch history, and OAuth tokens in that database. `.data/` and `.env` are ignored by Git. On POSIX systems, the app attempts to set the data directory to mode `0700` and the main database file to `0600`.

OAuth tokens are stored as plaintext inside the locally protected database. Do not copy or share it.

To reset Mailroom completely, stop the backend and remove `.data/`. This removes local accounts, tokens, fetch history, and message inventory; it does not change Gmail. The Disconnect button only clears local tokens and does not revoke the grant in the Google account.

## Project structure

```text
.
├── code.gs                    # Original Apps Script; retained as reference and not used at runtime
├── src/
│   ├── pages/                 # Fetch, Messages, and Senders screens
│   ├── components/            # Shared navigation, headers, pagination, and empty state
│   ├── account-context.tsx    # Account list, active-account selection, and OAuth UI actions
│   ├── api.ts                 # Typed frontend calls to the local API
│   └── styles.css             # Reset, font faces, and all application styling
├── public/
│   └── fonts/                 # Routed Gothic web fonts and their SIL Open Font License
├── server/
│   ├── src/
│   │   ├── index.ts           # Express routes and static production serving
│   │   ├── worker.ts          # Gmail job loop, throttling, retry logic, and ingestion
│   │   ├── google-auth.ts     # OAuth URL, callback exchange, and token refresh persistence
│   │   ├── database.ts        # SQLite initialization, schema, indexes, and startup recovery
│   │   ├── query.ts           # Message filtering, sorting, pagination, and CSV escaping
│   │   └── parsers.ts         # Gmail header extraction helpers
│   └── test/                  # Focused parser tests
├── .env.example
├── package.json
└── vite.config.ts
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for job semantics, data-model details, retry behavior, and current scaling boundaries.

## HTTP API

The React client uses these endpoints directly. There is no separate API authentication layer because the server is loopback-only.

| Method | Route | Behavior |
| --- | --- | --- |
| `GET` | `/api/health` | Return `{ "ok": true }`. |
| `GET` | `/api/auth/status` | Return OAuth configuration status and all locally known accounts without tokens. |
| `GET` | `/api/auth/google/start` | Create a 10-minute OAuth state value and return Google's authorization URL. |
| `GET` | `/api/auth/google/callback` | Exchange Google's authorization code, upsert the account by email, and redirect to `/fetch`. |
| `POST` | `/api/accounts/:accountId/disconnect` | Clear local OAuth tokens while retaining messages and jobs. |
| `POST` | `/api/accounts/:accountId/jobs` | Queue a fetch. JSON body: `{ "query": "in:inbox older:1y" }`. Queries must contain 1–1,000 characters after trimming. |
| `GET` | `/api/accounts/:accountId/jobs` | Return the 12 most recent jobs for the account. |
| `POST` | `/api/jobs/:jobId/retry` | Move a failed job back to `queued`. Returns 409 for a job not currently failed. |
| `GET` | `/api/accounts/:accountId/messages` | Return a page of account messages. |
| `GET` | `/api/accounts/:accountId/messages.csv` | Stream all matching account messages as CSV. |
| `GET` | `/api/accounts/:accountId/senders` | Return grouped sender counts. |
| `GET` | `/api/accounts/:accountId/senders.csv` | Stream all matching sender counts as CSV. |

Message list and CSV parameters:

- `search`: substring search across `sender_email` and `subject`
- any stored field name: per-column substring filter
- `sortBy`: one of the seven stored field names; defaults to `received_at`
- `sortDir`: `asc` or `desc`; any value other than `asc` becomes descending
- `page`: one-based page number; list endpoint only
- `pageSize`: clamped to 10–100 and defaults to 25; list endpoint only

Sender list and CSV parameters:

- `search`: sender-email substring search
- `sortBy`: `sender_email` or `message_count`; defaults to `message_count`
- `sortDir`: `asc` or `desc`
- `page` and `pageSize`: list endpoint only, with the same bounds as messages

## Possible next versions

These features were discussed or are natural continuations, but none exists in the current code:

- Archive, label, trash, delete, or unsubscribe actions. These would require `gmail.modify`, explicit confirmation, and an audit trail.
- Pause or cancel controls for queued and running jobs.
- Per-fetch result snapshots and filtering. The current inventory is cumulative by account and has no job-to-message join table.
- Durable Gmail page-token checkpoints. Restarted jobs currently enumerate their query again from page one.
- Automatic date-range splitting for very large searches.
- Incremental synchronization through Gmail History, scheduled fetches, or background operation when the Node process is not running.
- Refreshing previously stored messages or removing local rows when messages are deleted or no longer match a Gmail query.
- Additional headers or metadata such as labels, sender display names, message size, and `List-Unsubscribe`.
- UI controls to delete an account and its local data or revoke the OAuth grant at Google.
- Full-text search, cursor pagination, batched metadata requests, or concurrent per-account workers for larger datasets.
- Versioned database migrations. The current schema is created with `CREATE TABLE IF NOT EXISTS` statements at startup.
- Remote or multi-user deployment, including login, authorization boundaries, encrypted token storage, TLS, and operational monitoring.
- API, worker, OAuth, database, and browser-level automated tests. The current tests cover only the parsing helpers.
