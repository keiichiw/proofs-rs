CREATE TABLE zulip_deliveries (
  event_id TEXT PRIMARY KEY REFERENCES outbox_events(id),
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  lease_until TEXT,
  attempt_token TEXT,
  message_id INTEGER,
  last_error TEXT
);
