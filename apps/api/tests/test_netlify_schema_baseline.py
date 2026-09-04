from pathlib import Path

from app.netlify_schema_baseline import (
    render_postgresql_baseline,
    render_synthetic_rehearsal_seed,
    schema_inventory,
    synthetic_rehearsal_manifest,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
BASELINE_PATH = (
    REPOSITORY_ROOT
    / "netlify"
    / "database"
    / "migrations"
    / "20260904060000_create-arc-one-baseline"
    / "migration.sql"
)


def test_netlify_schema_baseline_matches_models_and_committed_migration() -> None:
    inventory = schema_inventory()

    assert inventory == {
        "tables": 43,
        "columns": 524,
        "indexes": 112,
        "unique_constraints": 26,
        "foreign_keys": 0,
    }
    assert BASELINE_PATH.read_text(encoding="utf-8") == render_postgresql_baseline()


def test_synthetic_rehearsal_seed_is_repeatable_and_contains_no_secret_values() -> None:
    seed_sql = render_synthetic_rehearsal_seed()
    manifest = synthetic_rehearsal_manifest()

    assert manifest["row_counts"] == {
        "organizations": 1,
        "users": 1,
        "workspaces": 1,
        "workspace_memberships": 1,
        "workflow_runs": 1,
        "execution_jobs": 1,
    }
    assert manifest["logical_reference_violations"] == 0
    assert manifest["workflow_run_totals"] == {
        "score": 88,
        "prompt_tokens": 10,
        "completion_tokens": 5,
        "total_tokens": 15,
        "cost_usd": 1.25,
        "duration_ms": 250,
    }
    assert manifest["status_distributions"]["workflow_runs"] == {"completed": 1}
    assert "'completed', 'synthetic-input'" in seed_sql
    assert "\ufffd" not in seed_sql
    assert seed_sql.count("ON CONFLICT (id) DO NOTHING") == 6
    assert not any(
        forbidden in seed_sql.lower()
        for forbidden in (
            "database_url",
            "postgresql://",
            "postgres://",
            "bearer ",
            "api_key",
            "@qq.com",
            "delete ",
            "drop ",
            "truncate ",
        )
    )
