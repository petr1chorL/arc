INSERT INTO netlify_platform_probe_events (
    operation_id,
    last_event_id,
    status,
    attempt_count,
    completed_at
)
VALUES (
    'preview-isolation-gate-20260904',
    'preview-isolation-gate-20260904',
    'completed',
    1,
    CURRENT_TIMESTAMP
)
ON CONFLICT (operation_id) DO NOTHING;
