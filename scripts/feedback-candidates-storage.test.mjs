import { expect, it } from 'vitest'
import { readFeedbackCandidates } from '../netlify/functions/_shared/feedback-candidates/postgres.ts'

it('reads scoped source text with explicit nullable fields and without leaking internal columns', async () => {
  const queries = []
  const row = { id: 'candidate', workspace_id: 'a', human_task_id: 'task', original_version_id: 'original',
    modified_version_id: 'modified', diff_id: 'diff', reason: 'reason', tags: ['tag'], workflow_run_id: 'run',
    workflow_id: null, agent_id: null, source_node_id: 'node', created_by: 'reviewer', status: '待确认',
    created_at: new Date('2026-09-05T00:00:00Z'), confirmed_at: null }
  const client = { release() {}, async query(sql, values) {
    queries.push([sql, values])
    if (sql.includes('FROM feedback_candidates')) return { rows: [row] }
    if (sql.includes('FROM artifact_versions')) return { rows: [{ content: values[1] === 'original' ? 'before' : 'after' }] }
    if (sql.includes('FROM artifact_diffs')) return { rows: [{ unified_diff: '-before\n+after' }] }
    throw new Error(`Unexpected query: ${sql}`)
  } }
  expect(await readFeedbackCandidates(client, 'a', 'candidate')).toEqual({
    id: 'candidate', humanTaskId: 'task', originalVersionId: 'original', modifiedVersionId: 'modified',
    originalContent: 'before', modifiedContent: 'after', unifiedDiff: '-before\n+after', reason: 'reason', tags: ['tag'],
    workflowRunId: 'run', workflowId: null, agentId: null, sourceNodeId: 'node', createdBy: 'reviewer',
    status: '待确认', createdAt: '2026-09-05T00:00:00.000Z', confirmedAt: null,
  })
  for (const [sql, values] of queries) { expect(sql).toContain('workspace_id=$1'); expect(values[0]).toBe('a') }
})
