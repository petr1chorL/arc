-- A completion receipt only: no account data or passwords are seeded by this migration.
CREATE TABLE native_bootstrap_state (
    id TEXT PRIMARY KEY CHECK (id = 'arc-one'),
    completed_at TIMESTAMPTZ NOT NULL
);
