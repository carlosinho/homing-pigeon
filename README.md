# Mailroom

Mailroom is a local Gmail inventory for finding which senders account for the
most messages. It runs Gmail searches in the background, stores message metadata
in SQLite, and provides sortable message and sender views with CSV exports.

It reads and stores only:

- sender email
- subject
- received date (`internalDate`)
- RFC Message-ID
- Gmail search expression
- Gmail message ID
- Gmail thread ID

Message bodies and attachments are never requested.

## Requirements

- Node.js 22 or newer
- A Google Cloud project with the Gmail API enabled
- OAuth credentials for your own Google account

## Google OAuth setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable the Gmail API for the project.
4. Configure the OAuth consent screen. For a personal proof of concept, add your
   Gmail address as a test user.
5. Add the `https://www.googleapis.com/auth/gmail.readonly` scope.
6. Create an OAuth client with application type **Web application**.
7. Add this authorized redirect URI:

   ```text
   http://localhost:3001/api/auth/google/callback
   ```

8. Copy `.env.example` to `.env` and add the client ID and client secret.

The narrower `gmail.metadata` scope cannot run queries through Gmail's `q`
parameter, so Mailroom needs `gmail.readonly`. The app still requests only
metadata from individual messages.

OAuth projects left in Google's Testing publishing state can require you to
reconnect periodically.

## Run locally

Install dependencies:

```bash
npm install
```

Start the React UI and local API:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The browser can be closed while a fetch runs, but the terminal running Mailroom
must remain open. If that process stops, an interrupted job is put back in the
queue and safely starts over on the next launch; messages already stored are
skipped.

## Production-style local build

Build both parts:

```bash
npm run build
```

Set `APP_URL=http://localhost:3001` in `.env`, then run:

```bash
npm start
```

Open [http://localhost:3001](http://localhost:3001).

## Local data

The SQLite database and OAuth tokens are stored in `.data/mailroom.db`. The
directory is excluded from Git and uses restrictive file permissions where the
operating system supports them.

To remove all locally stored Mailroom data, stop the app and delete the `.data`
directory. This does not delete or modify anything in Gmail.

## Useful commands

```bash
npm run build
npm test
```
