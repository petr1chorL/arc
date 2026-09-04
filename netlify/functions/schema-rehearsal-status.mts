import { createHash } from 'node:crypto'

import { getDatabase } from '@netlify/database'

import { createSchemaRehearsalHandler } from './_shared/schema-rehearsal.ts'


const expectedTables = [
  'agent_versions',
  'agents',
  'artifact_diffs',
  'artifact_versions',
  'artifacts',
  'audit_events',
  'data_object_definitions',
  'data_object_versions',
  'evaluations',
  'execution_jobs',
  'feedback_candidates',
  'golden_samples',
  'human_reviews',
  'human_tasks',
  'invitations',
  'model_providers',
  'node_runs',
  'notification_channels',
  'notification_outbox',
  'organizations',
  'regression_runs',
  'regression_sample_sets',
  'regression_samples',
  'remediation_task_activities',
  'remediation_tasks',
  'resume_requests',
  'review_decisions',
  'review_group_members',
  'review_groups',
  'reviewers',
  'rubric_versions',
  'rubrics',
  'schedule_dispatches',
  'sessions',
  'tool_skill_asset_invocations',
  'tool_skill_assets',
  'users',
  'workflow_runs',
  'workflow_schedules',
  'workflow_versions',
  'workflows',
  'workspace_memberships',
  'workspaces',
] as const

const syntheticIds = {
  organizations: '00000000-0000-4000-8000-000000000001',
  users: '00000000-0000-4000-8000-000000000002',
  workspaces: '00000000-0000-4000-8000-000000000003',
  workspace_memberships: '00000000-0000-4000-8000-000000000004',
  workflow_runs: '00000000-0000-4000-8000-000000000005',
  execution_jobs: '00000000-0000-4000-8000-000000000006',
} as const

type DatabaseRow = Record<string, unknown>

function numberValue(value: unknown): number {
  return Number(value ?? 0)
}

function primaryKeyDigest(recordId: string): string {
  return createHash('sha256').update(recordId).digest('hex')
}

function keyedNumbers(rows: DatabaseRow[]): Record<string, number> {
  return Object.fromEntries(
    rows.map((row) => [String(row.table_name), numberValue(row.value)]),
  )
}

async function loadSchemaRehearsalReport(): Promise<unknown> {
  const database = getDatabase()
  const [tableRows, countRows, statusRows, constraintRows, referenceRows, totalRows] =
    await Promise.all([
      database.sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'agent_versions', 'agents', 'artifact_diffs', 'artifact_versions',
            'artifacts', 'audit_events', 'data_object_definitions',
            'data_object_versions', 'evaluations', 'execution_jobs',
            'feedback_candidates', 'golden_samples', 'human_reviews', 'human_tasks',
            'invitations', 'model_providers', 'node_runs', 'notification_channels',
            'notification_outbox', 'organizations', 'regression_runs',
            'regression_sample_sets', 'regression_samples',
            'remediation_task_activities', 'remediation_tasks', 'resume_requests',
            'review_decisions', 'review_group_members', 'review_groups', 'reviewers',
            'rubric_versions', 'rubrics', 'schedule_dispatches', 'sessions',
            'tool_skill_asset_invocations', 'tool_skill_assets', 'users',
            'workflow_runs', 'workflow_schedules', 'workflow_versions', 'workflows',
            'workspace_memberships', 'workspaces'
          )
        ORDER BY table_name
      `,
      database.sql`
        SELECT 'organizations' AS table_name, COUNT(*)::int AS value FROM organizations WHERE id = ${syntheticIds.organizations}
        UNION ALL SELECT 'users', COUNT(*)::int FROM users WHERE id = ${syntheticIds.users}
        UNION ALL SELECT 'workspaces', COUNT(*)::int FROM workspaces WHERE id = ${syntheticIds.workspaces}
        UNION ALL SELECT 'workspace_memberships', COUNT(*)::int FROM workspace_memberships WHERE id = ${syntheticIds.workspace_memberships}
        UNION ALL SELECT 'workflow_runs', COUNT(*)::int FROM workflow_runs WHERE id = ${syntheticIds.workflow_runs}
        UNION ALL SELECT 'execution_jobs', COUNT(*)::int FROM execution_jobs WHERE id = ${syntheticIds.execution_jobs}
      `,
      database.sql`
        SELECT 'organizations' AS table_name, status, COUNT(*)::int AS value FROM organizations WHERE id = ${syntheticIds.organizations} GROUP BY status
        UNION ALL SELECT 'users', status, COUNT(*)::int FROM users WHERE id = ${syntheticIds.users} GROUP BY status
        UNION ALL SELECT 'workspaces', status, COUNT(*)::int FROM workspaces WHERE id = ${syntheticIds.workspaces} GROUP BY status
        UNION ALL SELECT 'workspace_memberships', status, COUNT(*)::int FROM workspace_memberships WHERE id = ${syntheticIds.workspace_memberships} GROUP BY status
        UNION ALL SELECT 'workflow_runs', status, COUNT(*)::int FROM workflow_runs WHERE id = ${syntheticIds.workflow_runs} GROUP BY status
        UNION ALL SELECT 'execution_jobs', status, COUNT(*)::int FROM execution_jobs WHERE id = ${syntheticIds.execution_jobs} GROUP BY status
      `,
      database.sql`
        SELECT COUNT(*)::int AS value
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND constraint_type = 'FOREIGN KEY'
          AND table_name IN (
            'agent_versions', 'agents', 'artifact_diffs', 'artifact_versions',
            'artifacts', 'audit_events', 'data_object_definitions',
            'data_object_versions', 'evaluations', 'execution_jobs',
            'feedback_candidates', 'golden_samples', 'human_reviews', 'human_tasks',
            'invitations', 'model_providers', 'node_runs', 'notification_channels',
            'notification_outbox', 'organizations', 'regression_runs',
            'regression_sample_sets', 'regression_samples',
            'remediation_task_activities', 'remediation_tasks', 'resume_requests',
            'review_decisions', 'review_group_members', 'review_groups', 'reviewers',
            'rubric_versions', 'rubrics', 'schedule_dispatches', 'sessions',
            'tool_skill_asset_invocations', 'tool_skill_assets', 'users',
            'workflow_runs', 'workflow_schedules', 'workflow_versions', 'workflows',
            'workspace_memberships', 'workspaces'
          )
      `,
      database.sql`
        SELECT (
          (SELECT COUNT(*) FROM users u LEFT JOIN organizations o ON o.id = u.organization_id LEFT JOIN workspaces w ON w.id = u.last_workspace_id WHERE u.id = ${syntheticIds.users} AND (o.id IS NULL OR w.id IS NULL)) +
          (SELECT COUNT(*) FROM workspaces w LEFT JOIN organizations o ON o.id = w.organization_id LEFT JOIN users u ON u.id = w.created_by WHERE w.id = ${syntheticIds.workspaces} AND (o.id IS NULL OR u.id IS NULL)) +
          (SELECT COUNT(*) FROM workspace_memberships m LEFT JOIN workspaces w ON w.id = m.workspace_id LEFT JOIN users u ON u.id = m.user_id LEFT JOIN users inviter ON inviter.id = m.invited_by WHERE m.id = ${syntheticIds.workspace_memberships} AND (w.id IS NULL OR u.id IS NULL OR inviter.id IS NULL)) +
          (SELECT COUNT(*) FROM workflow_runs r LEFT JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ${syntheticIds.workflow_runs} AND w.id IS NULL) +
          (SELECT COUNT(*) FROM execution_jobs j LEFT JOIN workspaces w ON w.id = j.workspace_id LEFT JOIN workflow_runs r ON r.id = j.run_id LEFT JOIN users u ON u.id = j.created_by WHERE j.id = ${syntheticIds.execution_jobs} AND (w.id IS NULL OR r.id IS NULL OR u.id IS NULL))
        )::int AS value
      `,
      database.sql`
        SELECT
          COALESCE(SUM(score), 0)::int AS score,
          COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
          COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
          COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
          COALESCE(SUM(duration_ms), 0)::int AS duration_ms
        FROM workflow_runs
        WHERE id = ${syntheticIds.workflow_runs}
      `,
    ])

  const presentTables = new Set(
    (tableRows as DatabaseRow[]).map((row) => String(row.table_name)),
  )
  const statusDistributions: Record<string, Record<string, number>> = {}
  for (const row of statusRows as DatabaseRow[]) {
    const tableName = String(row.table_name)
    statusDistributions[tableName] = {
      [String(row.status)]: numberValue(row.value),
    }
  }
  const totals = (totalRows as DatabaseRow[])[0] ?? {}

  return {
    status: 'ok',
    tableCount: presentTables.size,
    missingTables: expectedTables.filter((table) => !presentTables.has(table)),
    rowCounts: keyedNumbers(countRows as DatabaseRow[]),
    primaryKeyDigests: Object.fromEntries(
      Object.entries(syntheticIds).map(([table, recordId]) => [
        table,
        primaryKeyDigest(recordId),
      ]),
    ),
    physicalForeignKeys: numberValue((constraintRows as DatabaseRow[])[0]?.value),
    logicalReferenceViolations: numberValue((referenceRows as DatabaseRow[])[0]?.value),
    statusDistributions,
    workflowRunTotals: {
      score: numberValue(totals.score),
      promptTokens: numberValue(totals.prompt_tokens),
      completionTokens: numberValue(totals.completion_tokens),
      totalTokens: numberValue(totals.total_tokens),
      costUsd: numberValue(totals.cost_usd),
      durationMs: numberValue(totals.duration_ms),
    },
  }
}

export default createSchemaRehearsalHandler(loadSchemaRehearsalReport)
