// Real human decisions and same-Operation checkpoint recovery; no real model or production connection.
import assert from 'node:assert/strict'
import { runtimeTestDatabase } from './runtime-test-db.mjs'
import { submitWorkflow, readRun } from '../netlify/functions/_shared/runtime/workflow.ts'
import { processRuntimeOperation } from '../netlify/functions/_shared/runtime/service.ts'
import { runtimeWithTransaction, enqueueOperation } from '../netlify/functions/_shared/runtime/ledger.ts'
import { mutateHuman } from '../netlify/functions/_shared/runtime-closure/human.ts'
import { controlOperation } from '../netlify/functions/_shared/runtime/controls.ts'

const db = await runtimeTestDatabase(), pool = db.pool
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function bounded(promise, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Barrier timeout: ${label}`)), 6000) })]) }
  finally { clearTimeout(timer) }
}
function observedPool(onQuery) {
  return { async connect() { const client = await pool.connect(); return {
    async query(sql, values) { await onQuery(sql, values); return client.query(sql, values) },
    release() { client.release() },
  } } }
}
try {
  await pool.query("INSERT INTO users(id,organization_id,display_name,status,is_organization_admin,failed_login_count,created_at,updated_at) VALUES('actor','org','Synthetic','active',false,0,now(),now())")
  await pool.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status,created_at,updated_at) VALUES('member','w','actor','operator','active',now(),now())")
  await pool.query("INSERT INTO reviewers VALUES('reviewer','w','actor','Synthetic','reviewer',false,true,now())")
  const snapshot = { id: 'wf', name: 'Human then evaluation recovery', nodes: [
    { id: 'start', type: 'trigger', data: {} },
    { id: 'human', type: 'human', data: { reviewerIds: ['reviewer'], reviewPolicy: 'any_one', assignmentType: 'direct' } },
    { id: 'judge', type: 'evaluation', data: { rubricRef: { rubricId: 'synthetic-rubric', versionId: 'synthetic-version', version: 'v1' } } },
    { id: 'end', type: 'end', data: {} },
  ], edges: [{ id: 'e1', source: 'start', target: 'human' }, { id: 'e2', source: 'human', target: 'judge' },
    { id: 'e3', source: 'judge', target: 'end' }] }
  await pool.query("INSERT INTO workflows VALUES('wf','w','Synthetic','已发布','v1.0.0',$1,$2,'{}','{}',now(),now())", [JSON.stringify(snapshot.nodes), JSON.stringify(snapshot.edges)])
  await pool.query("INSERT INTO workflow_versions VALUES('version','w','wf','v1.0.0',$1,'',now())", [JSON.stringify(snapshot)])
  for (const decision of ['modify_and_approve', 'approve', 'cancel_after_requeue']) {
    let preEffectFailure = true, modelCalls = 0
    const deps = { complete: async () => { throw Error('unexpected external model request') },
      evaluateNode: async (_op, ctx, args) => {
        if (preEffectFailure) throw Error('Synthetic evaluator pre-effect failure')
        return ctx.effect(`synthetic-judge:${args.nodeRunId}`, { input: args.artifactText }, async () => {
          modelCalls++
          assert.equal(args.artifactText, decision === 'modify_and_approve' ? 'approved revised' : 'original')
          return { content: 'judged approved result', model: 'synthetic', promptTokens: 3, completionTokens: 2, costUsd: 0, score: 90 }
        })
      } }
    const { operation, run } = await runtimeWithTransaction(pool, client => submitWorkflow(client, {
      workspaceId: 'w', workflowId: 'wf', inputText: 'original', idempotencyKey: decision, actorId: 'actor',
    }))
    for (let i = 0; i < 3; i++) await processRuntimeOperation(pool, operation.id, deps)
    assert.equal((await pool.query('SELECT status FROM runtime_operations WHERE id=$1', [operation.id])).rows[0].status, 'waiting_review')
    const task = (await pool.query('SELECT * FROM human_tasks WHERE workflow_run_id=$1', [run.id])).rows[0]
    const old = (await pool.query('SELECT artifact_id,content FROM artifact_versions WHERE id=$1', [task.artifact_version_id])).rows[0]
    const response = await runtimeWithTransaction(pool, client => mutateHuman(client, 'w', task.id, 'actor', 'decisions', {
      decision: decision === 'modify_and_approve' ? decision : 'approve', reason: 'synthetic approval',
      artifactVersionId: task.artifact_version_id, idempotencyKey: `${decision}-vote`,
      ...(decision === 'modify_and_approve' ? { modifiedContent: 'approved revised' } : {}),
    }, { enqueue: enqueueOperation }))
    const resumeId = response.body.resumeOperation.operationId
    const failed = await processRuntimeOperation(pool, resumeId, deps)
    assert.equal(failed.status, 'failed')
    assert.equal(modelCalls, 0, 'pre-effect failure does not call model')
    assert.equal((await pool.query('SELECT status FROM human_tasks WHERE id=$1', [task.id])).rows[0].status, '恢复失败')
    assert.equal((await pool.query('SELECT count(*)::int n FROM runtime_effects WHERE operation_id=$1', [resumeId])).rows[0].n, 0)
    const requeued = await runtimeWithTransaction(pool, client => controlOperation(client, 'w', resumeId, 'requeue', { reason: 'synthetic fix applied' }, 'actor'))
    assert.equal(requeued.id, resumeId, 'requeue preserves exact Operation identity')
    preEffectFailure = false
    if (decision === 'cancel_after_requeue') {
      await runtimeWithTransaction(pool, client => controlOperation(client, 'w', operation.id, 'cancel', { reason: 'synthetic cancellation' }, 'actor'))
      await processRuntimeOperation(pool, resumeId, deps)
      assert.equal((await runtimeWithTransaction(pool, client => readRun(client, 'w', run.id))).status, '已取消')
      assert.equal((await pool.query('SELECT status FROM human_tasks WHERE id=$1', [task.id])).rows[0].status, '恢复失败', 'canceled parent cannot repair task to success')
      assert.equal(modelCalls, 0, 'canceled parent never invokes evaluator')
    } else {
      for (let i = 0; i < 4; i++) await processRuntimeOperation(pool, resumeId, deps)
      const completed = await runtimeWithTransaction(pool, client => readRun(client, 'w', run.id))
      assert.equal(completed.id, run.id); assert.equal(completed.status, '已完成')
      assert.equal((await pool.query('SELECT status FROM human_tasks WHERE id=$1', [task.id])).rows[0].status,
        decision === 'modify_and_approve' ? '修改后通过' : '已通过')
      assert.equal((await pool.query('SELECT status FROM runtime_operations WHERE id=$1', [resumeId])).rows[0].status, 'succeeded')
      assert.equal((await pool.query('SELECT status FROM resume_requests WHERE human_task_id=$1', [task.id])).rows[0].status, 'succeeded')
      assert.equal(await processRuntimeOperation(pool, resumeId, deps), null, 'duplicate consumer does not reenter completed operation')
      assert.equal(modelCalls, 1, 'recovery and duplicate consumption do not repeat successful effect')
    }
    assert.equal((await pool.query('SELECT count(*)::int n FROM review_decisions WHERE human_task_id=$1', [task.id])).rows[0].n, 1, 'decision not resubmitted')
    assert.equal((await pool.query('SELECT count(*)::int n FROM artifact_versions WHERE artifact_id=$1', [old.artifact_id])).rows[0].n,
      decision === 'modify_and_approve' ? 2 : 1, 'reviewed artifact versions not recreated')
    assert.equal((await pool.query('SELECT content FROM artifact_versions WHERE id=$1', [task.artifact_version_id])).rows[0].content, old.content, 'original artifact unchanged')
    assert.equal((await pool.query("SELECT count(*)::int n FROM runtime_operation_events WHERE operation_id=$1 AND event_type='human.resume.initialized'", [resumeId])).rows[0].n, 1, 'initialized decision is not reapplied')
  }

  async function waitingResume(key, deps) {
    const { operation, run } = await runtimeWithTransaction(pool, client => submitWorkflow(client, {
      workspaceId: 'w', workflowId: 'wf', inputText: 'original', idempotencyKey: key, actorId: 'actor',
    }))
    for (let i = 0; i < 3; i++) await processRuntimeOperation(pool, operation.id, deps)
    const task = (await pool.query('SELECT * FROM human_tasks WHERE workflow_run_id=$1', [run.id])).rows[0]
    const decision = await runtimeWithTransaction(pool, client => mutateHuman(client, 'w', task.id, 'actor', 'decisions', {
      decision: 'approve', reason: key, artifactVersionId: task.artifact_version_id, idempotencyKey: `${key}-vote`,
    }, { enqueue: enqueueOperation }))
    return { operation, run, task, resumeId: decision.body.resumeOperation.operationId }
  }

  // Cancellation already owns parent; a lease must wait on parent before acquiring Run.
  // A Run-first lease would deadlock when this transaction subsequently updates that Run.
  {
    let modelCalls = 0
    const deps = { complete: async () => { throw Error('unexpected model call') }, evaluateNode: async () => {
      modelCalls++; throw Error('canceled parent must prevent evaluation')
    } }
    const item = await waitingResume('cancel-vs-lease-barrier', deps)
    const waitingParent = deferred(), cancellation = await pool.connect()
    let worker
    try {
      await cancellation.query('BEGIN')
      await cancellation.query('SELECT id FROM runtime_operations WHERE id=$1 FOR UPDATE', [item.operation.id])
      const instrumented = observedPool(async (sql, values) => {
        if (sql.includes("kind='workflow.run'") && values?.[1] === item.run.id) {
          assert.match(sql, /FOR UPDATE/, 'all parent rows must be locked before Run')
          waitingParent.resolve()
        }
      })
      worker = processRuntimeOperation(instrumented, item.resumeId, deps)
      void worker.catch(() => {}) // Keep cleanup reachable if the competing transaction fails first.
      await bounded(waitingParent.promise, 'lease waits on parent')
      await bounded(controlOperation(cancellation, 'w', item.operation.id, 'cancel', { reason: 'barrier cancellation' }, 'actor'), 'cancel acquires Run without inverse lock')
      await cancellation.query('COMMIT')
      await bounded(worker, 'canceled lease settles')
      assert.equal(modelCalls, 0)
      assert.equal((await pool.query('SELECT status FROM workflow_runs WHERE id=$1', [item.run.id])).rows[0].status, '已取消')
      assert.equal((await pool.query('SELECT count(*)::int n FROM runtime_effects WHERE operation_id=$1', [item.resumeId])).rows[0].n, 0)
    } finally {
      await cancellation.query('ROLLBACK'); cancellation.release()
      if (worker) await worker.catch(() => {})
    }
  }

  // Pause a final successful settlement before it asks for parent. Cancellation then owns
  // parent and waits for Run; the callback must not own Run while waiting for parent.
  {
    let fail = true, modelCalls = 0
    const deps = { complete: async () => { throw Error('unexpected model call') }, evaluateNode: async (_op, ctx, args) => {
      if (fail) throw Error('synthetic pre-effect failure')
      return ctx.effect(`barrier-judge:${args.nodeRunId}`, {}, async () => {
        modelCalls++; return { content: 'synthetic judgment', model: 'synthetic', promptTokens: 1, completionTokens: 1, costUsd: 0, score: 90 }
      })
    } }
    const item = await waitingResume('cancel-vs-settlement-barrier', deps)
    assert.equal((await processRuntimeOperation(pool, item.resumeId, deps)).status, 'failed')
    await runtimeWithTransaction(pool, client => controlOperation(client, 'w', item.resumeId, 'requeue', { reason: 'synthetic repair' }, 'actor'))
    fail = false
    for (let i = 0; i < 2; i++) assert.equal((await processRuntimeOperation(pool, item.resumeId, deps)).status, 'queued')
    const beforeSettle = deferred(), parentLocked = deferred(), waitingParent = deferred()
    let settlementStarted = false, worker
    const cancellation = await pool.connect()
    try {
      const instrumented = observedPool(async (sql, values) => {
        if (sql.startsWith('UPDATE runtime_operations SET status=$3,result=$4') && values?.[0] === item.resumeId && values?.[2] === 'succeeded') {
          settlementStarted = true; beforeSettle.resolve(); await parentLocked.promise
        }
        if (settlementStarted && sql.includes("kind='workflow.run'") && values?.[1] === item.run.id) {
          assert.match(sql, /FOR UPDATE/, 'settlement locks actual parent before Run')
          waitingParent.resolve()
        }
      })
      worker = processRuntimeOperation(instrumented, item.resumeId, deps)
      void worker.catch(() => {})
      await bounded(beforeSettle.promise, 'completed evaluator awaits settlement')
      await cancellation.query('BEGIN')
      await cancellation.query('SELECT id FROM runtime_operations WHERE id=$1 FOR UPDATE', [item.operation.id])
      parentLocked.resolve()
      await bounded(waitingParent.promise, 'settlement waits on parent')
      await bounded(controlOperation(cancellation, 'w', item.operation.id, 'cancel', { reason: 'cancel during final settlement' }, 'actor'), 'cancel takes Run without deadlock')
      await cancellation.query('COMMIT')
      await bounded(worker, 'settlement sees canceled parent')
      assert.equal(modelCalls, 1, 'already completed synthetic effect is not replayed')
      assert.equal((await pool.query('SELECT status FROM workflow_runs WHERE id=$1', [item.run.id])).rows[0].status, '已取消')
      assert.equal((await pool.query('SELECT status FROM human_tasks WHERE id=$1', [item.task.id])).rows[0].status, '恢复失败', 'canceled parent cannot restore failed task')
      assert.equal((await pool.query('SELECT count(*)::int n FROM review_decisions WHERE human_task_id=$1', [item.task.id])).rows[0].n, 1)
    } finally {
      parentLocked.resolve()
      await cancellation.query('ROLLBACK'); cancellation.release()
      if (worker) await worker.catch(() => {})
    }
  }

  for (const field of ['runId', 'humanTaskId', 'resumeRequestId', 'decisionId', 'artifactVersionId', 'action', 'target_id']) {
    let sends = 0
    const deps = { complete: async () => { sends++; throw Error('unexpected model call') }, evaluateNode: async () => { sends++; throw Error('invalid association must not execute') } }
    const item = await waitingResume(`invalid-${field}`, deps)
    if (field === 'target_id') await pool.query("UPDATE runtime_operations SET target_id='foreign' WHERE id=$1", [item.resumeId])
    else await pool.query('UPDATE runtime_operations SET input=jsonb_set(input,$2::text[],to_jsonb($3::text)) WHERE id=$1', [item.resumeId, [field], 'foreign'])
    assert.equal((await processRuntimeOperation(pool, item.resumeId, deps)).status, 'failed')
    assert.equal(sends, 0)
    assert.equal((await pool.query("SELECT count(*)::int n FROM runtime_operation_events WHERE operation_id=$1 AND event_type='human.resume.initialized'", [item.resumeId])).rows[0].n, 0)
  }
  console.log('Human resume recovery PostgreSQL: same-Operation recovery, modified/ordinary durable terminal status, cancellation and no duplicate decision/artifact/effect passed.')
} finally { await db.close() }
