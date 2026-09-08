# Homing Pigeon

Homing Pigeon is a local Gmail inventory for answering a practical cleanup question: which senders and messages account for the most storage in an account? Gives you a browser interface, a background fetch process, local persistence, and CSV exports.

Homing Pigeon is read-only. It does not archive, label, trash, delete, or unsubscribe from messages.

## What it does

Homing Pigeon runs the same search syntax as the Gmail search box and stores one row for each matching Gmail message. The stored fields are:

- `sender_email`, extracted from the `From` header and normalized to lowercase
- `subject`
- `received_at`, taken from Gmail's `internalDate`
- `rfc_message_id`, taken from the `Message-ID` header with surrounding angle brackets removed
- `gmail_search`, generated as `rfc822msgid:<id>` when an RFC Message-ID is available
- `gmail_message_id`
- `gmail_thread_id`
- Gmail's estimated message size
- attachment count, size, filename, and MIME type metadata

The app requests headers, size estimates, and MIME metadata, but excludes message bodies and attachment data. Repeating or overlapping searches does not create duplicate rows because messages are unique by Gmail account and Gmail message ID.

The inventory is cumulative for each account. A completed fetch adds new messages to that account's existing inventory; the Messages and Senders screens are not limited to the results of one particular fetch.

The Messages screen can delete all locally stored messages for the selected account. This does not change Gmail, connected accounts, or fetch history. A later fetch can import the same messages again. Successful erases appear alongside fetches in the Fetch screen's Activity list.

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

The backend lists matching Gmail messages in pages of up to 500, fetches the required headers, estimated size, and attachment metadata for each new message, and records progress in SQLite. The browser can be closed while a fetch runs, but the Node process must remain running.

Only one fetch is processed at a time across all connected accounts. Gmail requests are sequential and throttled by `REQUEST_DELAY_MS`. Temporary quota and server errors are retried with exponential backoff.

If the process stops during a fetch, that job is returned to the queue on the next startup. It starts its Gmail query again from the first page and skips messages already stored. It does not resume from a saved Gmail page token.

### 3. Browse messages

The Messages screen provides server-side pagination, sorting on every stored field, sender/subject search, and per-column substring filters. It defaults to largest messages first and shows message size plus expandable attachment metadata. **More columns** reveals the RFC message ID, Gmail search, Gmail message ID, and thread ID. The external-link action opens a Gmail search for the selected message.

The received-date filter is matched against a UTC `YYYY-MM-DD HH:MM:SS` representation in SQLite, while dates displayed in the browser use the browser's local timezone.

### 4. Rank senders and domains

The Senders screen groups the current account's stored messages by normalized sender email. It defaults to the greatest combined message size and also shows message count. Selecting a sender opens the Messages screen with that sender filter applied.

The Domains screen derives the portion after `@` from each normalized sender email and groups messages by that domain. Sender values without a domain are grouped under Unknown domain. Selecting a domain opens the Messages screen with an exact domain filter applied.

### 5. Export CSV

The Messages, Senders, and Domains screens export all rows matching the active account, filters, search, and sort order; exports are not limited to the visible page. Message CSV files include message size and attachment metadata. Sender CSV files include `sender_email`, `message_count`, and `total_size_bytes`; domain CSV files contain `sender_domain` and `message_count`.

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

Information moved to `GoogleOAuth.md`

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

If the port or hostname changes, update `PORT`, `APP_URL`, `GOOGLE_REDIRECT_URI`, and the authorized redirect URI in Google Cloud together. Remote deployment is not supported by the current security model.

## Local data and reset

The backend creates `.data/mailroom.db`, enables SQLite WAL mode, and stores message metadata, fetch history, and OAuth tokens in that database. `.data/` and `.env` are ignored by Git. On POSIX systems, the app attempts to set the data directory to mode `0700` and the main database file to `0600`.

OAuth tokens are stored as plaintext inside the locally protected database. Do not copy or share it.

To reset Homing Pigeon completely, stop the backend and remove `.data/`. This removes local accounts, tokens, fetch history, and message inventory; it does not change Gmail. The Disconnect button only clears local tokens and does not revoke the grant in the Google account.

## Project structure

```text
.
├── legacy/
│   └── code.gs                # Original Apps Script; retained as reference and not used at runtime
├── src/
│   ├── assets/                # Frontend image assets, including the Homing Pigeon logo
│   ├── pages/                 # Fetch, Messages, Senders, and Domains screens
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

See [ROADMAP.md](./ROADMAP.md) for shipped milestones, the development backlog, known issues, and pending decisions.

## HTTP API

The React client uses these endpoints directly. There is no separate API authentication layer because the server is loopback-only.

| Method | Route | Behavior |
| --- | --- | --- |
| `GET` | `/api/health` | Return `{ "ok": true }`. |
| `GET` | `/api/auth/status` | Return OAuth configuration status and all locally known accounts without tokens. |
| `GET` | `/api/auth/google/start` | Create a 10-minute OAuth state value and return Google's authorization URL. |
| `GET` | `/api/auth/google/callback` | Exchange Google's authorization code, upsert the account by email, and redirect to `/fetch`. |
| `POST` | `/api/accounts/:accountId/disconnect` | Clear local OAuth tokens while retaining messages and jobs. |
| `DELETE` | `/api/accounts/:accountId/messages` | Delete all locally stored messages for the account. Returns 409 while the account has a queued or running fetch. |
| `POST` | `/api/accounts/:accountId/jobs` | Queue a fetch. JSON body: `{ "query": "in:inbox older:1y" }`. Queries must contain 1–1,000 characters after trimming. |
| `GET` | `/api/accounts/:accountId/jobs` | Return recent fetch jobs and local-data activity for the account. |
| `POST` | `/api/jobs/:jobId/retry` | Move a failed job back to `queued`. Returns 409 for a job not currently failed. |
| `GET` | `/api/accounts/:accountId/messages` | Return a page of account messages. |
| `GET` | `/api/accounts/:accountId/messages.csv` | Stream all matching account messages as CSV. |
| `GET` | `/api/accounts/:accountId/senders` | Return grouped sender counts. |
| `GET` | `/api/accounts/:accountId/senders.csv` | Stream all matching sender counts as CSV. |
| `GET` | `/api/accounts/:accountId/domains` | Return grouped sender-domain counts. |
| `GET` | `/api/accounts/:accountId/domains.csv` | Stream all matching sender-domain counts as CSV. |

Message list and CSV parameters:

- `search`: substring search across `sender_email` and `subject`
- `sender_domain`: exact derived sender-domain filter, including an empty value for messages without a domain
- any stored field name: per-column substring filter
- `sortBy`: a stored public field, including message and attachment size; defaults to `received_at` in the API and `size_bytes` in the Messages UI
- `sortDir`: `asc` or `desc`; any value other than `asc` becomes descending
- `page`: one-based page number; list endpoint only
- `pageSize`: clamped to 10–100 and defaults to 25; list endpoint only

Sender list and CSV parameters:

- `search`: sender-email substring search
- `sortBy`: `sender_email`, `message_count`, or `total_size_bytes`; defaults to `total_size_bytes`
- `sortDir`: `asc` or `desc`
- `page` and `pageSize`: list endpoint only, with the same bounds as messages

Domain list and CSV parameters:

- `search`: sender-domain substring search
- `sortBy`: `sender_domain` or `message_count`; defaults to `message_count`
- `sortDir`: `asc` or `desc`
- `page` and `pageSize`: list endpoint only, with the same bounds as messages
