ALTER TABLE netlify_platform_probe_events
    RENAME COLUMN event_id TO operation_id;

ALTER TABLE netlify_platform_probe_events
    ADD COLUMN last_event_id TEXT;

UPDATE netlify_platform_probe_events
SET last_event_id = operation_id
WHERE last_event_id IS NULL;

ALTER TABLE netlify_platform_probe_events
    ALTER COLUMN last_event_id SET NOT NULL;

CREATE TABLE netlify_platform_probe_dispatches (
    suite_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('claimed', 'completed', 'failed')),
    event_ids JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
