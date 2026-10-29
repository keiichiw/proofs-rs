# Zulip announcements

Production can announce new reports, revisions and comments in one Zulip channel,
using the stable topic `Report #<id>`. Messages contain English metadata and links;
report and comment bodies are not copied. Email preferences do not affect these
announcements. Events are recorded only while production Zulip is enabled; there
is no historical backfill. Disable the integration to cancel pending announcements.

Create a generic Zulip bot and subscribe it to the destination channel. Set these
GitHub production environment variables:

- `PRODUCTION_ZULIP_ENABLED=true` (defaults to disabled)
- `PRODUCTION_ZULIP_SITE=https://your-organization.zulipchat.com`
- `PRODUCTION_ZULIP_CHANNEL_ID` to the numeric destination channel ID
- `PRODUCTION_ZULIP_BOT_EMAIL` to the bot's API email address

Store the bot API key in the production environment secret
`PRODUCTION_ZULIP_API_KEY`. The production workflow validates configuration and
installs it as the Worker secret `ZULIP_API_KEY`. Never put the key in Wrangler
vars or source control. Staging and local environments never send announcements.

The existing queue dispatch runs after publication and every five minutes. A
15-second request timeout and 60-second delivery lease prevent overlapping sends.
Transient failures retry with exponential backoff, respecting Retry-After, up to
eight attempts. Authentication and other permanent HTTP errors fail immediately.
Delivery after an ambiguous response may produce duplicate Zulip messages.

Inspect `zulip_deliveries` joined to `outbox_events` by `event_id` for status,
attempts, `last_error` and `message_id`. Logs contain only event IDs, attempt
counts and sanitized outcome codes. After correcting a failed integration, retry
one selected event using a D1 transaction/batch with these parameterized SQL
statements (replace `?` with the same event ID):

```sql
UPDATE zulip_deliveries
SET status='pending', attempts=0, next_attempt_at=NULL,
    lease_until=NULL, attempt_token=NULL, last_error=NULL
WHERE event_id=? AND status='failed';
UPDATE outbox_events SET completed_at=NULL, enqueued_at=NULL
WHERE id=? AND EXISTS (
  SELECT 1 FROM zulip_deliveries d
  WHERE d.event_id=outbox_events.id AND d.status='pending'
);
```

Only retry after inspecting the target topic for an already-delivered message.
The next scheduled dispatch will enqueue the event. Hidden reports and deleted
or hidden comments are cancelled at send time. Existing sent messages are not
removed when content is subsequently hidden or deleted.
