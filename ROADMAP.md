# Development roadmap

## Roadmap

### v0.10 — Working local POC

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

### v0.20 — Actual MVP

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
- [ ] Add privacy view
   - Needed to record videos or make screenshots of the app's window without capturing email addresses in the open. This is purely for display purposes, meaning the parts of the emails should be obscured so that the whole email address is not identifiable. For example, we can redact every other character in the email. We can use the Redacted google font for that.
   - This can be a toggle in the settings. Do we have a settings page?
- [ ] Add version numbering with one source of truth like in my other apps.
- [ ] Add simple login like in OpenShelf.
- [ ] Some panel with suggestions
   - We can use it to show suggested actions based on the data set (emails) in the db. 
   - We can start by listing "suspicious" email addresses - ones that look like random sets of characters - commonly used for spam. For example, something like: df244h7j@gmail.com

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

### Dev/direction ideas by AI

#### Astra

1. **An ongoing newsletter and notification review**  
   A weekly review of who started emailing you, who increased their frequency, and which subscriptions you still want. Mark senders as “keep,” “reduce frequency,” or “unsubscribe,” and remember those decisions. This gives the app a recurring purpose beyond clearing an old backlog.  
   *Needs:* saved decisions, date comparisons, and eventually subscription headers.
2. **A map of the services you’ve signed up for**  
   Turn senders, domains, and welcome or verification subjects into a reviewable directory of services you may have accounts with. Useful for rediscovering forgotten registrations and deciding which accounts to close. Each entry would link to supporting messages; receiving mail alone wouldn’t establish that an account exists.  
   *Needs:* service grouping, candidate detection, and manual confirmation.
3. **An email-address migration checklist**  
   When moving away from an old address, identify organizations and people you may need to notify. Track “address updated,” “account closed,” and “still to review.” Your existing support for multiple Gmail accounts could also help spot services still contacting the old address.  
   *Needs:* checklist state and a view across accounts.
4. **A Gmail filter workbench**  
   Help you design rules such as “archive promotions from this retailer, but preserve receipts and delivery updates.” Preview matching messages and exceptions before handing the rule over to Gmail. This would make your current inventory useful for preventing future clutter.  
   *Needs:* a rule builder, sample previews, and clear distinction between matches in the imported inventory and Gmail.
5. **An inbox noise report**  
   Show which sources account for recent incoming volume, which are growing, and how the mix changes after you adjust subscriptions. Answer “Did my inbox actually get quieter?”  
   *Needs:* date-range analytics and consistent fetch coverage. Current cumulative counts alone cannot measure cleanup success.
6. **A personal correspondence timeline**  
   Group messages into named collections such as “apartment search,” “job applications,” or “home renovation,” spanning multiple senders and domains. Browse the chronology and open the original messages when needed.  
   *Needs:* saved collections and manual tagging. Subjects and dates support an initial version; extracting events or commitments would require content.
7. **A notification-settings audit**  
   Separate useful messages from excessive notifications within the same service: security alerts, activity updates, recommendations, promotions. Present examples so you can decide what to disable in that service’s settings. This is more precise than treating an entire domain as unwanted.  
   *Needs:* subject-pattern grouping and user-defined categories.
8. **A receipt and renewal finder**  
   Surface likely receipts, invoices, subscription notices, and renewals by service, with links to the originals. Useful for finding documentation and spotting subscriptions worth reviewing.  
   *Needs:* subject-based candidate detection initially. Reliable amounts, renewal dates, and payment status would require message content.
9. **A storage cleanup planner**  
   Identify senders and message groups consuming the most space, rather than merely sending the most messages. A handful of large messages might be a better cleanup target than thousands of short notifications.  
   *Needs:* message-size and attachment metadata, plus reconciliation with Gmail to measure reclaimed space.
10. **A follow-up review for personal correspondence**  
    Surface conversations where you may owe a reply or be waiting for one, with the user deciding whether follow-up is needed.  
    *Needs:* sent-mail ingestion, recipient metadata, refreshed thread information, and potentially content. This is a larger expansion than the other ideas.

#### Fable

**Use cases that reuse the existing inventory almost as-is:**
1. Storage reclaim planner. Rank by size and attachment bytes, then show "delete these 200 messages to free 3 GB". The metadata is already there. Add a cumulative-size column and a "selected total" so the user can pick a target before touching Gmail. This is the cleanest fit and the one Gmail's own UI does badly.
2. Attachment locator and archive. Search across all attachment filenames and MIME types you have stored. "Every PDF over 1 MB from my accountant", "all invoices with .xlsx". Optionally download attachments to disk in bulk, then delete the originals. Gmail search cannot filter by filename substring across all mail the way SQL can.
3. Subscription and newsletter audit. Store the List-Unsubscribe and List-Id headers. Show senders with a list header, message count, and last-received date. Give a one-click unsubscribe by opening the mailto or HTTPS link. This is the version of "useless communications" that does not require the modify scope.
4. Sender relationship report. Per sender: first seen, last seen, monthly volume, reply rate if you also fetch from:me. Who emails you most, who has gone quiet, which vendors are ramping up. Useful for personal CRM or for spotting a contact you forgot to answer.
5. Mailbox time-series and trend dashboard. Messages and bytes per month, split by domain. Shows when a mailbox started growing and which domains caused it. Requires only the received_at and size columns already stored.

**Use cases that need a few more stored fields:**
6. Label and category audit. Store Gmail labels and categories per message. Show which labels are dead, which filters are misrouting, and which Promotions senders leak into Primary. Basis for a "fix my filters" tool that proposes filter rules from observed patterns.
7. Thread and conversation analysis. Group by thread ID. Find the longest threads, threads with the most attachments, or threads that span years. Helps locate the one thread you actually need to keep before bulk deleting a sender.
8. Duplicate and forwarded-copy detection. Same RFC Message-ID or same subject plus size across accounts, or repeated newsletters delivered to several aliases. You already connect multiple accounts,  detection is a natural extension.
9. Multi-account consolidation view. Run the same senders and domains views across all connected accounts at once. Answer "which of my three
   addresses does this vendor use" and decide which alias t
10. Security and identity audit. Store the Reply-To and Return-Path headers plus SPF, DKIM, and DMARC results from Authentication-Results. Flag
    senders whose display name mimics a known domain or whoservice that has sent you a password reset or login code,giving a list of accounts you hold online.
11. Account inventory from signup mail. Related to 10: class like "welcome", "verify your email", "your account" andderive a list of services registered to that address. Useful for GDPR requests, account deletion, or a will-and-estate list.

**Use cases that change what the app is:**
12. Rules engine with dry-run. Let the user write rules such as "domain X, older than 1 year, no attachments" and preview the matching count and
    size against the local inventory before anything touches archive, label, or trash with the modify scope and anaudit trail. The dry-run against SQLite is the differentiator: Gmail search cannot show you the byte total before you act.
13. Scheduled sync and drift detection. Run the fetch on a messages disappeared from Gmail. Gives a local changelog ofthe mailbox and makes the inventory trustworthy over time. Also enables "what arrived this week" digests.
14. Offline searchable mail index. Add FTS on subject and, y. A fast local search across several accounts with SQLfilters is something Gmail's UI never gives you.
15. Export for migration or backup. Use the inventory to drof selected messages, then delete them from Gmail. Fitspeople leaving Gmail or archiving an old account.
16. Compliance and retention helper for small businesses. Pes, reports on what would be deleted under each, and anexport of what was deleted and when. Same engine as 12 with a reporting layer.

## Known issues / tech debt

- Restart recovery replays a query from its first page because Gmail page tokens and per-message work are not persisted.
- One in-process worker and one process-wide rate limiter serialize all accounts; restarting the API also stops active Gmail work.
- New messages require individual `messages.get` calls; there is no batching or controlled concurrency.
- SQLite offset pagination, substring `LIKE` filters, and on-demand sender/domain grouping will become slower on large inventories.
- Sender and domain search treat `%` and `_` as SQL wildcards, unlike message column filters, which escape them.
- OAuth tokens are plaintext in SQLite and the API has no login, request authorization, origin validation, or explicit CSRF protection; operation is intentionally loopback-only.
- OAuth state is process-local, so restarting the backend invalidates an authorization flow already in progress.
- Disconnecting an account does not stop an OAuth client already used by a running job; a later refresh may fail after tokens are cleared.
- Startup uses `CREATE TABLE IF NOT EXISTS` and has no general migration runner; the activity-event target and message category columns have explicit compatibility upgrades.
- Account-scoped read routes return empty results for unknown account IDs, and unmatched built-deployment GET requests may return the React application instead of JSON 404.
- `REQUEST_DELAY_MS` is not checked for a finite, non-negative value.
- Automated tests cover parsers, minimal domain-query behavior, and focused classification behavior; most API, worker, OAuth, CSV, database, and browser behavior needs manual verification.

## Decisions pending

- TBD
