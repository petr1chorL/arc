import test from 'node:test'
import assert from 'node:assert/strict'
import { toolTestFixture } from './runtime-tool-test-fixture.mjs'
import { processRuntimeOperation } from '../netlify/functions/_shared/runtime/service.ts'

test('disabled queued Tool fails before creating a send intention',async()=>{
  const db=await toolTestFixture()
  try{
    const {operationId:id}=await (await db.submit()).json()
    await db.pool.query("UPDATE tool_skill_assets SET status='disabled' WHERE id='tool-a'")
    let calls=0
    const op=await processRuntimeOperation(db.pool,id,{complete:async()=>{throw Error()},toolOptions:{allowedBindings:[{workspaceId:'a',host:'tools.example.invalid'}],fetch:async()=>{calls++;return Response.json({})}}})
    assert.equal(op.status,'failed');assert.equal(op.result.errorCode,'asset_disabled');assert.equal(calls,0)
    assert.equal((await db.pool.query('SELECT * FROM runtime_effects')).rows.length,0)
  }finally{await db.close()}
})

test('independent Tool test is durably accepted without a fake Agent or Run',async()=>{
  const db=await toolTestFixture()
  try{
    const response=await db.submit()
    assert.equal(response.status,202)
    const accepted=await response.json()
    assert.equal(accepted.kind,'tool.test');assert.equal(accepted.status,'queued')
    assert.equal(accepted.invocationId,accepted.operationId);assert.equal(accepted.runId,undefined)
    const invocation=(await db.pool.query('SELECT * FROM tool_skill_asset_invocations')).rows[0]
    assert.equal(invocation.id,accepted.invocationId)
    assert.deepEqual([invocation.agent_id,invocation.run_id,invocation.node_run_id],[null,null,null])
    assert.equal(invocation.status,'pending')
    assert.equal((await db.pool.query('SELECT * FROM workflow_runs')).rows.length,0)
    assert.equal((await db.pool.query('SELECT * FROM runtime_tool_test_snapshots')).rows.length,1)
    assert.equal((await db.pool.query('SELECT * FROM runtime_event_outbox')).rows.length,1)
    assert.equal((await db.pool.query("SELECT * FROM audit_events WHERE action='tool_skill_asset.test_invoke'")).rows.length,1)
  }finally{await db.close()}
})

test('acceptance is stable across independent Sessions, asset edits and audit failure',async()=>{
  const db=await toolTestFixture()
  try{
    const second=await db.login();assert.notEqual(second.Cookie,db.headers.Cookie)
    const request=()=>db.request('asset-library/tool-a/test-invocations','POST',{parameters:{sku:'A001'}},{...second,'Idempotency-Key':'same'})
    const pair=await Promise.all([db.submit('same'),request()])
    assert.deepEqual(pair.map(r=>r.status),[202,202])
    const ids=(await Promise.all(pair.map(r=>r.json()))).map(r=>r.operationId)
    assert.equal(ids[0],ids[1])
    await db.pool.query("UPDATE tool_skill_assets SET status='disabled',adapter_config='{\"url\":\"https://changed.example.invalid\"}' WHERE id='tool-a'")
    assert.equal((await (await request()).json()).operationId,ids[0])
    assert.equal((await db.submit('same',{sku:'other'})).status,409)
    const snapshot=(await db.pool.query('SELECT asset_snapshot FROM runtime_tool_test_snapshots')).rows[0].asset_snapshot
    assert.equal(snapshot.adapterConfig.url,'https://tools.example.invalid/lookup')
    assert.equal((await db.pool.query('SELECT * FROM runtime_event_outbox')).rows.length,1)
    assert.equal((await db.pool.query("SELECT * FROM audit_events WHERE action='tool_skill_asset.test_invoke'")).rows.length,1)
    await db.pool.query("UPDATE tool_skill_assets SET status='active' WHERE id='tool-a'")
    await db.pool.query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_tool_audit CHECK(action<>'tool_skill_asset.test_invoke') NOT VALID")
    assert.equal((await db.submit('rollback')).status,503)
    for(const table of ['runtime_operations','runtime_tool_test_snapshots','tool_skill_asset_invocations','runtime_event_outbox'])
      assert.equal((await db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,1)
  }finally{await db.close()}
})

test('standalone HTTP Tool consumes its fixed request exactly once and returns no private body',async()=>{
  const db=await toolTestFixture()
  try{
    const accepted=await (await db.submit()).json();let calls=0
    const deps={complete:async()=>{throw Error('must not call model')},toolOptions:{allowedBindings:[{workspaceId:'a',host:'tools.example.invalid'}],fetch:async(url,options)=>{
      calls++;assert.equal(url,'https://tools.example.invalid/lookup');assert.deepEqual(JSON.parse(options.body),{sku:'A001'})
      assert.equal(options.headers['Idempotency-Key'],accepted.invocationId)
      return Response.json({private:'synthetic-output-marker'})
    }}}
    const operation=await processRuntimeOperation(db.pool,accepted.operationId,deps)
    assert.equal(operation.status,'succeeded')
    assert.equal(calls,1)
    assert.equal(JSON.stringify(operation.result).includes('synthetic-output-marker'),false)
    assert.equal((await db.pool.query('SELECT status FROM tool_skill_asset_invocations')).rows[0].status,'succeeded')
    await processRuntimeOperation(db.pool,accepted.operationId,deps)
    assert.equal(calls,1)
  }finally{await db.close()}
})

test('Tool operation controls cannot be reached with the weaker run.execute permission or jobs aliases',async()=>{
  const db=await toolTestFixture()
  try{
    const accepted=await (await db.submit()).json(),id=accepted.operationId
    await db.pool.query("UPDATE workspace_memberships SET role='operator' WHERE id='a'")
    assert.equal((await db.request(`operations/${id}/cancel`,'POST',{reason:'operator'})).status,403)
    assert.equal((await db.request(`execution-jobs/${id}`)).status,404)
    assert.equal((await db.request(`execution-jobs/${id}/cancel`,'POST',{reason:'alias'})).status,404)
    await db.pool.query("UPDATE workspace_memberships SET role='builder' WHERE id='a'")
    assert.equal((await db.request(`operations/${id}/cancel`,'POST',{reason:'builder'})).status,200)
    assert.equal((await db.pool.query('SELECT status FROM tool_skill_asset_invocations')).rows[0].status,'canceled')
    let calls=0
    await processRuntimeOperation(db.pool,id,{complete:async()=>{throw Error()},toolOptions:{allowedBindings:[{workspaceId:'a',host:'tools.example.invalid'}],fetch:async()=>{calls++;return Response.json({})}}})
    assert.equal(calls,0)
  }finally{await db.close()}
})
