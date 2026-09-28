CREATE TABLE reasoning_events (
    id UUID PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('plan', 'authorize', 'verify')),
    task TEXT NOT NULL,
    reasoner_model TEXT NOT NULL,
    outcome TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX reasoning_events_created_idx
    ON reasoning_events (created_at DESC);
