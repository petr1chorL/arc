import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runtimeTestDatabase } from './runtime-test-db.mjs'

const sql = readFileSync(new URL('./cutover-source-inventory.sql', import.meta.url), 'utf8')

async function inventory(pool, text = sql) {
  const client = await pool.connect(), notices = []
  const capture = message => notices.push(message.message)
  client.on('notice', capture)
  try { await client.query(text); return notices }
  catch (error) { error.inventoryNotices = notices; throw error }
  finally { await client.query('ROLLBACK'); client.off('notice', capture); client.release() }
}

test('source inventory reports exact read-only counts without private row contents', async () => {
  const db = await runtimeTestDatabase()
  try {
    for (const [id, status] of [['done', '已完成'], ['waiting', '等待审核'], ['unknown', 'new_state']]) {
      await db.pool.query(`INSERT INTO workflow_runs
        (id,workspace_id,kind,name,status,input_text,output_text,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at)
        VALUES($1,'synthetic','workflow','PRIVATE_ROW_MARKER',$2,'PRIVATE_ROW_MARKER','PRIVATE_ROW_MARKER','',0,0,0,0,0,'','','',now())`, [id, status])
    }
    const notices = await inventory(db.pool)
    const raw = notices.find(value => value.startsWith('ARC_SOURCE_INVENTORY '))
    assert.ok(raw)
    assert.equal(notices.filter(value => value.startsWith('ARC_SOURCE_INVENTORY ')).length, 1)
    assert.equal(raw.includes('PRIVATE_ROW_MARKER'), false)
    const report = JSON.parse(raw.slice('ARC_SOURCE_INVENTORY '.length))
    assert.equal(report.readOnly, true)
    assert.equal(report.isolation, 'repeatable read')
    assert.equal(report.tableCount, 43)
    assert.equal(report.rowCounts.workflow_runs, 3)
    assert.equal(report.rowCounts.users, 0)
    assert.equal(report.tasks.workflow_runs.total, 3)
    assert.equal(report.tasks.workflow_runs.nonterminal, 2)
    assert.deepEqual(report.tasks.workflow_runs.statusCounts, { '已完成': 1, '等待审核': 1, new_state: 1 })
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM workflow_runs')).rows[0].n, 3)
    await assert.rejects(inventory(db.pool, sql.replace('ROLLBACK;', "INSERT INTO organizations VALUES('write','x','x','active',now(),now()); ROLLBACK;")), { code: '25006' })
  } finally { await db.close() }
})

test('source inventory fails for missing ARC schema or missing status columns rather than returning zero', async () => {
  const db = await runtimeTestDatabase()
  try {
    await assert.rejects(inventory(db.pool, `SET search_path=pg_catalog; ${sql}`), /ARC source table missing/)
    await db.pool.query('ALTER TABLE execution_jobs RENAME COLUMN status TO synthetic_wrong_status')
    await assert.rejects(inventory(db.pool), /status/)
  } finally { await db.close() }
})

test('source inventory has a bounded lock wait and does not report partial success', async () => {
  const db = await runtimeTestDatabase(), locker = await db.pool.connect()
  try {
    await locker.query('BEGIN; LOCK TABLE workflow_runs IN ACCESS EXCLUSIVE MODE')
    const started = Date.now()
    await assert.rejects(inventory(db.pool), error => error.code === '55P03'
      && !error.inventoryNotices.some(value => value.startsWith('ARC_SOURCE_INVENTORY ')))
    assert.ok(Date.now() - started < 5000)
  } finally { await locker.query('ROLLBACK'); locker.release(); await db.close() }
})
