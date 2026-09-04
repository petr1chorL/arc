CREATE TABLE netlify_platform_probe_events (
    event_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('started', 'completed')),
    attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);
