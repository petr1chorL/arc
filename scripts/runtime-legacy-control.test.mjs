import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeTestDatabase } from './runtime-test-db.mjs'
import { seedRuntimeIdentity } from './runtime-http.test.mjs'
import { createRuntimeHandler } from '../netlify/functions/_shared/runtime/handler.ts'
import { createPostgresRuntimeBackend } from '../netlify/functions/_shared/runtime/postgres.ts'
import { enqueueOperation, runtimeWithTransaction } from '../netlify/functions/_shared/runtime/ledger.ts'

test('retired manual worker claim retains authentication, CSRF, Workspace, permission and audit boundaries', async () => {
  const db = await runtimeTestDatabase()
  try {
    const { cookie, csrf } = await seedRuntimeIdentity(db.pool)
    const handler = createRuntimeHandler(createPostgresRuntimeBackend(db.pool))
    const path = '/api/workspaces/a/execution-jobs/next'
    const request = (url = path, headers = {}) => handler(new Request(`https://synthetic.invalid${url}`, {
      method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf, ...headers },
    }))
    assert.equal((await request(path, { Cookie: '' })).status, 401)
    assert.equal((await request(path, { 'X-CSRF-Token': '' })).status, 403)
    assert.equal((await request(path, { Origin: 'https://foreign.invalid' })).status, 403)
    assert.equal((await request(path.replace('/a/', '/b/'))).status, 404)
    await db.pool.query("UPDATE workspace_memberships SET role='viewer' WHERE id='member'")
    assert.equal((await request()).status, 403)
    await db.pool.query("UPDATE workspace_memberships SET role='operator' WHERE id='member'")
    const result = await request()
    assert.equal(result.status, 410)
    assert.match((await result.json()).detail, /异步执行器/)
    const audit = (await db.pool.query("SELECT action,outcome,target_id FROM audit_events WHERE action='execution_job.process_next' AND outcome='denied'")).rows
    assert.equal(audit.length, 2)
    assert.equal(audit.at(-1).target_id, 'a')
    assert.equal((await db.pool.query('SELECT * FROM runtime_operations')).rows.length, 0)
    assert.equal((await db.pool.query('SELECT * FROM execution_jobs')).rows.length, 0)
  } finally { await db.close() }
})

test('legacy Run deletion reports its unmigrated contract without changing any Run or durable operation', async () => {
  const db = await runtimeTestDatabase()
  try {
    const { cookie, csrf } = await seedRuntimeIdentity(db.pool)
    const handler = createRuntimeHandler(createPostgresRuntimeBackend(db.pool))
    for (const [id, status] of [['completed', '已完成'], ['active', '运行中'], ['uncertain', '失败']]) {
      await db.pool.query(`INSERT INTO workflow_runs
        (id,workspace_id,kind,name,status,input_text,output_text,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at)
        VALUES ($1,'a','workflow','Synthetic',$2,'input','output','',0,0,0,0,0,'','','',now())`, [id, status])
    }
    const op = await runtimeWithTransaction(db.pool, client => enqueueOperation(client, {
      workspaceId: 'a', kind: 'workflow.run', idempotencyKey: 'uncertain', input: { runId: 'uncertain' }, targetId: 'uncertain',
    }))
    await db.pool.query("UPDATE runtime_operations SET status='needs_reconciliation' WHERE id=$1", [op.id])
    await db.pool.query("INSERT INTO runtime_effects(operation_id,effect_key,request_hash,status) VALUES($1,'synthetic-call','synthetic','uncertain')", [op.id])
    await db.pool.query(`INSERT INTO runtime_node_checkpoints(run_id,workspace_id,node_id,node_run_id,input_text,output_text,status)
      VALUES('uncertain','a','node','node-run','input','output','succeeded')`)
    const beforeRuns = (await db.pool.query('SELECT * FROM workflow_runs ORDER BY id')).rows
    const beforeOperations = (await db.pool.query('SELECT * FROM runtime_operations ORDER BY id')).rows
    const beforeEffects = (await db.pool.query('SELECT * FROM runtime_effects')).rows
    const beforeCheckpoints = (await db.pool.query('SELECT * FROM runtime_node_checkpoints')).rows
    const request = (id = 'completed', headers = {}, workspace = 'a') => handler(new Request(
      `https://synthetic.invalid/api/workspaces/${workspace}/runs/${id}`, {
        method: 'DELETE', headers: { Cookie: cookie, 'X-CSRF-Token': csrf, ...headers },
      }))
    assert.equal((await request('completed', { Cookie: '' })).status, 401)
    assert.equal((await request('completed', { 'X-CSRF-Token': '' })).status, 403)
    assert.equal((await request('completed', { Origin: 'https://foreign.invalid' })).status, 403)
    assert.equal((await request('completed', {}, 'b')).status, 404)
    assert.equal((await request('missing')).status, 404)
    await db.pool.query("UPDATE workspace_memberships SET role='viewer' WHERE id='member'")
    assert.equal((await request()).status, 403)
    await db.pool.query("UPDATE workspace_memberships SET role='operator' WHERE id='member'")
    for (const id of ['completed', 'active', 'uncertain']) {
      const result = await request(id)
      assert.equal(result.status, 409)
      assert.match((await result.json()).detail, /删除能力尚未迁移/)
    }
    assert.deepEqual((await db.pool.query('SELECT * FROM workflow_runs ORDER BY id')).rows, beforeRuns)
    assert.deepEqual((await db.pool.query('SELECT * FROM runtime_operations ORDER BY id')).rows, beforeOperations)
    assert.deepEqual((await db.pool.query('SELECT * FROM runtime_effects')).rows, beforeEffects)
    assert.deepEqual((await db.pool.query('SELECT * FROM runtime_node_checkpoints')).rows, beforeCheckpoints)
    assert.equal((await db.pool.query("SELECT * FROM audit_events WHERE action='run.delete' AND outcome='denied'")).rows.length, 4)
  } finally { await db.close() }
})
