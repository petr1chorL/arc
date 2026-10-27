import test from 'node:test'
import assert from 'node:assert/strict'
import { recoveredHumanTaskStatus } from '../netlify/functions/_shared/runtime/human-resume-status.ts'
import { requireLease } from '../netlify/functions/_shared/runtime/worker.ts'

test('successful resume restores modified approval from all persisted votes, not only its final action', async () => {
  const { recoveredHumanTaskStatus } = await import('../netlify/functions/_shared/runtime/human-resume-status.ts')
  const operation = { kind: 'human.resume', status: 'succeeded', workspace_id: 'w', target_id: 'resume',
    input: { runId: 'run', humanTaskId: 'task', resumeRequestId: 'resume', decisionId: 'last', action: 'approve' } }
  const task = { id: 'task', workspace_id: 'w', workflow_run_id: 'run', status: '恢复失败', review_policy: 'all',
    required_approvals: 2, participant_snapshot: ['r1', 'r2'] }
  const resume = { id: 'resume', workspace_id: 'w', human_task_id: 'task', decision_id: 'last', action: 'approve', status: 'succeeded' }
  const decisions = [{ id: 'first', workspace_id: 'w', human_task_id: 'task', reviewer_id: 'r1', decision: 'modify_and_approve' },
    { id: 'last', workspace_id: 'w', human_task_id: 'task', reviewer_id: 'r2', decision: 'approve' }]
  assert.equal(recoveredHumanTaskStatus(operation, task, resume, decisions), '修改后通过')
})

function fixture(action = 'approve', decision = action) {
  return [
    { kind: 'human.resume', status: 'succeeded', workspace_id: 'w', target_id: 'resume',
      input: { runId: 'run', humanTaskId: 'task', resumeRequestId: 'resume', decisionId: 'last', action } },
    { id: 'task', workspace_id: 'w', workflow_run_id: 'run', status: '恢复失败', review_policy: 'any_one',
      required_approvals: 1, participant_snapshot: ['r1'] },
    { id: 'resume', workspace_id: 'w', human_task_id: 'task', decision_id: 'last', action, status: 'succeeded' },
    [{ id: 'last', workspace_id: 'w', human_task_id: 'task', reviewer_id: 'r1', decision }],
  ]
}

test('persisted ordinary, rejected and returned decisions restore their precise terminal statuses', () => {
  for (const [action, decision, expected] of [['approve', 'approve', '已通过'], ['approve', 'modify_and_approve', '修改后通过'],
    ['reject', 'reject', '已驳回'], ['return_for_rerun', 'return_for_rerun', '已退回']]) {
    assert.equal(recoveredHumanTaskStatus(...fixture(action, decision)), expected)
  }
})

test('only successful human resumes may repair a currently failed task projection', () => {
  for (const status of ['failed', 'queued', 'running', 'canceled', 'needs_reconciliation']) {
    const args = fixture(); args[0].status = status; assert.equal(recoveredHumanTaskStatus(...args), null)
  }
  for (const status of ['审核中', '已通过', '修改后通过', '已驳回', '已退回']) {
    const args = fixture(); args[1].status = status; assert.equal(recoveredHumanTaskStatus(...args), null)
  }
  const args = fixture(); args[0].kind = 'workflow.run'; assert.equal(recoveredHumanTaskStatus(...args), null)
})

test('every workspace task run resume target and decision association must agree', () => {
  for (const [index, field] of [[0, 'workspace_id'], [0, 'target_id'], [1, 'workspace_id'], [1, 'id'], [1, 'workflow_run_id'],
    [2, 'id'], [2, 'workspace_id'], [2, 'human_task_id'], [2, 'decision_id'], [2, 'action'], [2, 'status']]) {
    const args = fixture(); args[index][field] = 'wrong'; assert.equal(recoveredHumanTaskStatus(...args), null, `${index}.${field}`)
  }
  for (const field of ['runId', 'humanTaskId', 'resumeRequestId', 'decisionId', 'action']) {
    const args = fixture(); args[0].input[field] = 'wrong'; assert.equal(recoveredHumanTaskStatus(...args), null, field)
  }
  for (const index of [1, 2]) {
    const args = fixture(); args[index] = undefined; assert.equal(recoveredHumanTaskStatus(...args), null)
  }
})

test('missing, foreign, nonparticipant, duplicate or insufficient durable votes cannot invent success', () => {
  for (const field of ['id', 'workspace_id', 'human_task_id', 'reviewer_id', 'decision']) {
    const args = fixture(); args[3][0][field] = 'wrong'; assert.equal(recoveredHumanTaskStatus(...args), null, field)
  }
  const empty = fixture(); empty[3] = []; assert.equal(recoveredHumanTaskStatus(...empty), null)
  const duplicate = fixture(); duplicate[3].push({ ...duplicate[3][0], id: 'duplicate' })
  assert.equal(recoveredHumanTaskStatus(...duplicate), null)
  const pending = fixture(); pending[1].participant_snapshot.push('r2'); pending[1].review_policy = 'all'
  assert.equal(recoveredHumanTaskStatus(...pending), null)
  const mismatch = fixture('approve', 'reject'); assert.equal(recoveredHumanTaskStatus(...mismatch), null)
})

test('group transfer retains historical modification evidence but counts only current participants for approval', () => {
  for (const policy of ['all', 'threshold']) {
    const args = fixture()
    args[1].review_policy = policy; args[1].required_approvals = 2; args[1].participant_snapshot = ['r2', 'r3']
    args[3] = [
      { id: 'old', workspace_id: 'w', human_task_id: 'task', reviewer_id: 'r1', decision: 'modify_and_approve' },
      { id: 'second', workspace_id: 'w', human_task_id: 'task', reviewer_id: 'r2', decision: 'approve' },
      { id: 'last', workspace_id: 'w', human_task_id: 'task', reviewer_id: 'r3', decision: 'approve' },
    ]
    assert.equal(recoveredHumanTaskStatus(...args), '修改后通过', policy)
    const noCurrentVotes = structuredClone(args); noCurrentVotes[3] = [args[3][0]]
    assert.equal(recoveredHumanTaskStatus(...noCurrentVotes), null, 'historical vote alone cannot authorize restoration')
    const historicalFinal = structuredClone(args); historicalFinal[0].input.decisionId = 'old'; historicalFinal[2].decision_id = 'old'
    assert.equal(recoveredHumanTaskStatus(...historicalFinal), null, 'final referenced decision must belong to a current participant')
  }
})

function leaseFixture(kind = 'human.resume', changedTask = {}) {
  const calls = []
  const operation = { ...fixture()[0], id: 'own', status: 'running', generation: 4, kind,
    input: { ...fixture()[0].input, artifactVersionId: 'artifact' } }
  const client = { async query(sql) {
    if (sql.includes('locked_until>clock_timestamp()')) { calls.push('own'); return { rows: [{ id: 'own' }] } }
    if (sql.includes('FROM human_tasks')) { calls.push('task'); return { rows: [{ ...fixture()[1], artifact_version_id: 'artifact', ...changedTask }] } }
    if (sql.includes("kind='workflow.run'")) { calls.push('parent'); assert.match(sql, /FOR UPDATE/); return { rows: [{ id: 'parent', status: 'waiting_review' }] } }
    if (sql.includes('FROM workflow_runs')) { calls.push('run'); return { rows: [{ id: 'run', status: '运行中' }] } }
    if (sql.includes('FROM resume_requests')) { calls.push('resume'); return { rows: [fixture()[2]] } }
    if (sql.includes('FROM review_decisions')) { calls.push('decision'); return { rows: fixture()[3].map(decision => ({ ...decision, artifact_version_id: 'artifact' })) } }
    throw Error(`Unexpected synthetic query ${sql}`)
  } }
  return { calls, operation, client }
}

test('lease locks every parent before Run and validates human associations before allowing business work', async () => {
  const human = leaseFixture()
  await requireLease(human.client, human.operation)
  assert.deepEqual(human.calls, ['own', 'task', 'parent', 'run', 'resume', 'decision'])
  const workflow = leaseFixture('workflow.resume')
  await requireLease(workflow.client, workflow.operation)
  assert.deepEqual(workflow.calls, ['own', 'parent', 'run'])
  const invalid = leaseFixture('human.resume', { workflow_run_id: 'wrong' })
  await assert.rejects(requireLease(invalid.client, invalid.operation), /关联无效/)
  assert.deepEqual(invalid.calls, ['own', 'task'])
})
