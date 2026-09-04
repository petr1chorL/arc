"""Render the current SQLAlchemy schema as deterministic PostgreSQL DDL."""

from hashlib import sha256

from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from app.models import Base


GENERATED_HEADER = """-- Generated from apps/api/app/models.py.
-- Do not edit this migration by hand; update the models and regenerate it.
-- This baseline is schema-only and contains no connection string or row data.
"""

SYNTHETIC_IDS = {
    "organizations": "00000000-0000-4000-8000-000000000001",
    "users": "00000000-0000-4000-8000-000000000002",
    "workspaces": "00000000-0000-4000-8000-000000000003",
    "workspace_memberships": "00000000-0000-4000-8000-000000000004",
    "workflow_runs": "00000000-0000-4000-8000-000000000005",
    "execution_jobs": "00000000-0000-4000-8000-000000000006",
}


def schema_inventory() -> dict[str, int]:
    """Return non-sensitive structural counts for the current model metadata."""
    tables = list(Base.metadata.tables.values())
    return {
        "tables": len(tables),
        "columns": sum(len(table.columns) for table in tables),
        "indexes": sum(len(table.indexes) for table in tables),
        "unique_constraints": sum(
            sum(isinstance(constraint, UniqueConstraint) for constraint in table.constraints)
            for table in tables
        ),
        "foreign_keys": sum(len(table.foreign_keys) for table in tables),
    }


def render_postgresql_baseline() -> str:
    """Compile tables and indexes into stable PostgreSQL migration SQL."""
    dialect = postgresql.dialect()
    tables = sorted(Base.metadata.tables.values(), key=lambda table: table.name)
    statements = [
        str(CreateTable(table).compile(dialect=dialect)).strip()
        for table in tables
    ]
    indexes = sorted(
        (index for table in tables for index in table.indexes),
        key=lambda index: index.name or "",
    )
    statements.extend(
        str(CreateIndex(index).compile(dialect=dialect)).strip()
        for index in indexes
    )
    return GENERATED_HEADER + "\n" + ";\n\n".join(statements) + ";\n"


def synthetic_rehearsal_manifest() -> dict[str, object]:
    """Return the expected non-sensitive summary for the synthetic rehearsal."""
    return {
        "expected_tables": sorted(Base.metadata.tables),
        "row_counts": {table: 1 for table in SYNTHETIC_IDS},
        "primary_key_digests": {
            table: sha256(record_id.encode("utf-8")).hexdigest()
            for table, record_id in SYNTHETIC_IDS.items()
        },
        "physical_foreign_keys": 0,
        "logical_reference_violations": 0,
        "status_distributions": {
            "organizations": {"active": 1},
            "users": {"active": 1},
            "workspaces": {"active": 1},
            "workspace_memberships": {"active": 1},
            "workflow_runs": {"completed": 1},
            "execution_jobs": {"completed": 1},
        },
        "workflow_run_totals": {
            "score": 88,
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
            "cost_usd": 1.25,
            "duration_ms": 250,
        },
    }


def render_synthetic_rehearsal_seed() -> str:
    """Render idempotent Preview-only inserts containing synthetic values."""
    organization_id = SYNTHETIC_IDS["organizations"]
    user_id = SYNTHETIC_IDS["users"]
    workspace_id = SYNTHETIC_IDS["workspaces"]
    membership_id = SYNTHETIC_IDS["workspace_memberships"]
    run_id = SYNTHETIC_IDS["workflow_runs"]
    job_id = SYNTHETIC_IDS["execution_jobs"]
    timestamp = "2026-09-04 00:00:00+00"
    return f"""-- Preview-only synthetic schema rehearsal data.
-- Contains no production row, credential, connection string, or real business text.

INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
VALUES ('{organization_id}', 'ARC.ONE Synthetic Rehearsal', 'arc-one-synthetic-rehearsal', 'active', '{timestamp}', '{timestamp}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (
    id, organization_id, email, normalized_email, display_name, password_hash,
    status, is_organization_admin, failed_login_count, locked_until,
    password_changed_at, last_login_at, last_workspace_id, created_at, updated_at
)
VALUES (
    '{user_id}', '{organization_id}', 'schema-rehearsal@example.invalid',
    'schema-rehearsal@example.invalid', 'Schema Rehearsal User', NULL,
    'active', FALSE, 0, NULL, NULL, NULL, '{workspace_id}', '{timestamp}', '{timestamp}'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspaces (id, organization_id, name, slug, status, created_by, created_at, updated_at)
VALUES (
    '{workspace_id}', '{organization_id}', 'Synthetic Rehearsal Workspace',
    'synthetic-rehearsal', 'active', '{user_id}', '{timestamp}', '{timestamp}'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_memberships (
    id, workspace_id, user_id, role, status, invited_by, activated_at, created_at, updated_at
)
VALUES (
    '{membership_id}', '{workspace_id}', '{user_id}', 'workspace_admin', 'active',
    '{user_id}', '{timestamp}', '{timestamp}', '{timestamp}'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_runs (
    id, workspace_id, kind, name, workflow_id, workflow_version, agent_id,
    agent_version, status, input_text, output_text, score, model, prompt_tokens,
    completion_tokens, total_tokens, cost_usd, duration_ms, current_node, error,
    trace_id, started_at, completed_at
)
VALUES (
    '{run_id}', '{workspace_id}', 'workflow', 'Schema Rehearsal Run', NULL, NULL,
    NULL, NULL, 'completed', 'synthetic-input', 'synthetic-output', 88,
    'synthetic-model', 10, 5, 15, 1.25, 250, 'end', '',
    'trace-schema-rehearsal', '{timestamp}', '{timestamp}'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO execution_jobs (
    id, workspace_id, run_id, workflow_id, workflow_version, job_type, status,
    input_text, attempts, max_attempts, error, created_by, created_at, locked_by,
    locked_until, last_heartbeat_at, next_attempt_at, started_at, completed_at,
    dead_lettered_at, canceled_at
)
VALUES (
    '{job_id}', '{workspace_id}', '{run_id}', NULL, NULL, 'workflow', 'completed',
    'synthetic-input', 1, 3, '', '{user_id}', '{timestamp}', '', NULL, NULL,
    NULL, '{timestamp}', '{timestamp}', NULL, NULL
)
ON CONFLICT (id) DO NOTHING;
"""
