-- Preview-only synthetic schema rehearsal data.
-- Contains no production row, credential, connection string, or real business text.

INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', 'ARC.ONE Synthetic Rehearsal', 'arc-one-synthetic-rehearsal', 'active', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (
    id, organization_id, email, normalized_email, display_name, password_hash,
    status, is_organization_admin, failed_login_count, locked_until,
    password_changed_at, last_login_at, last_workspace_id, created_at, updated_at
)
VALUES (
    '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'schema-rehearsal@example.invalid',
    'schema-rehearsal@example.invalid', 'Schema Rehearsal User', NULL,
    'active', FALSE, 0, NULL, NULL, NULL, '00000000-0000-4000-8000-000000000003', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspaces (id, organization_id, name, slug, status, created_by, created_at, updated_at)
VALUES (
    '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Synthetic Rehearsal Workspace',
    'synthetic-rehearsal', 'active', '00000000-0000-4000-8000-000000000002', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_memberships (
    id, workspace_id, user_id, role, status, invited_by, activated_at, created_at, updated_at
)
VALUES (
    '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'workspace_admin', 'active',
    '00000000-0000-4000-8000-000000000002', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_runs (
    id, workspace_id, kind, name, workflow_id, workflow_version, agent_id,
    agent_version, status, input_text, output_text, score, model, prompt_tokens,
    completion_tokens, total_tokens, cost_usd, duration_ms, current_node, error,
    trace_id, started_at, completed_at
)
VALUES (
    '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', 'workflow', 'Schema Rehearsal Run', NULL, NULL,
    NULL, NULL, '�����', 'synthetic-input', 'synthetic-output', 88,
    'synthetic-model', 10, 5, 15, 1.25, 250, 'end', '',
    'trace-schema-rehearsal', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO execution_jobs (
    id, workspace_id, run_id, workflow_id, workflow_version, job_type, status,
    input_text, attempts, max_attempts, error, created_by, created_at, locked_by,
    locked_until, last_heartbeat_at, next_attempt_at, started_at, completed_at,
    dead_lettered_at, canceled_at
)
VALUES (
    '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005', NULL, NULL, 'workflow', 'completed',
    'synthetic-input', 1, 3, '', '00000000-0000-4000-8000-000000000002', '2026-09-04 00:00:00+00', '', NULL, NULL,
    NULL, '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00', NULL, NULL
)
ON CONFLICT (id) DO NOTHING;

