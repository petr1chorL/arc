import test from 'node:test'
import assert from 'node:assert/strict'
import { toolTestFixture } from './runtime-tool-test-fixture.mjs'
import { processRuntimeOperation } from '../netlify/functions/_shared/runtime/service.ts'

const deps=fetch=>({complete:async()=>{throw Error('model not permitted')},toolOptions:{allowedBindings:[{workspaceId:'a',host:'tools.example.invalid'}],fetch}})

test('native pending history restores its Operation while keeping body and arbitrary historical states hidden',async()=>{
  const db=await toolTestFixture()
  try{
    const {operationId:id}=await (await db.submit()).json()
    const response=await db.request('asset-library/invocations')
    assert.equal(response.status,200)
    const [inv]=await response.json();assert.equal(inv.operationId,id);assert.equal(inv.status,'pending')
    assert.equal(inv.inputSummary.includes('A001'),false)
    await db.pool.query("UPDATE users SET is_organization_admin=true WHERE id='actor'")
    const audit=await db.request('asset-library/tool-a/audit-events');assert.equal(audit.status,200)
    assert.ok((await audit.json()).some(event=>event.metadata.operationId===id && event.metadata.phase==='accepted'))
    await db.pool.query("UPDATE runtime_operations SET kind='unknown.kind' WHERE id=$1",[id])
    assert.equal((await db.request('asset-library/invocations')).status,409)
  }finally{await db.close()}
})

test('unknown sends are not replayed and reconciliation/cancellation update the same Invocation',async()=>{
  const db=await toolTestFixture()
  try{
    const {operationId:id}=await (await db.submit()).json();let calls=0
    const unknown=deps(async()=>{calls++;throw Error('private endpoint failure')})
    const op=await processRuntimeOperation(db.pool,id,unknown)
    assert.equal(op.status,'needs_reconciliation');assert.equal(op.result.errorCode,'needs_reconciliation')
    assert.equal(op.error.includes('private'),false)
    await processRuntimeOperation(db.pool,id,unknown);assert.equal(calls,1)
    assert.equal((await db.request(`operations/${id}/requeue`,'POST',{reason:'not authorized replay'})).status,409)
    assert.equal((await db.request(`operations/${id}/reconcile`,'POST',{reason:'builder',decision:'retry',acknowledgeDuplicateRisk:true})).status,403)
    await db.pool.query("UPDATE users SET is_organization_admin=true WHERE id='actor'")
    const retry=await db.request(`operations/${id}/reconcile`,'POST',{reason:'synthetic external check',decision:'retry',acknowledgeDuplicateRisk:true})
    assert.equal(retry.status,200)
    assert.equal((await db.pool.query('SELECT status FROM tool_skill_asset_invocations')).rows[0].status,'pending')
    await db.pool.query("UPDATE tool_skill_assets SET status='disabled' WHERE id='tool-a'")
    const blocked=await processRuntimeOperation(db.pool,id,unknown)
    assert.equal(blocked.status,'failed');assert.equal(blocked.result.errorCode,'asset_disabled');assert.equal(calls,1)
  }finally{await db.close()}
})

test('known HTTP rejection and MCP configuration failure are failed Operations, not successful tests',async()=>{
  const db=await toolTestFixture()
  try{
    const a=await (await db.submit('rejected')).json()
    const rejected=await processRuntimeOperation(db.pool,a.operationId,deps(async()=>new Response('private rejection',{status:400})))
    assert.equal(rejected.status,'failed');assert.equal(rejected.result.errorCode,'http_rejected')
    await db.pool.query("UPDATE tool_skill_assets SET adapter_type='mcp',adapter_config='{}' WHERE id='tool-a'")
    const response=await db.submit('mcp');assert.equal(response.status,202)
    const b=await response.json()
    const mcp=await processRuntimeOperation(db.pool,b.operationId,deps(async()=>{throw Error('must not send')}))
    assert.equal(mcp.status,'failed');assert.equal(mcp.result.errorCode,'mcp_not_configured')
  }finally{await db.close()}
})

test('empty output retains an uncertain effect and matching Invocation instead of success or automatic replay',async()=>{
  const db=await toolTestFixture()
  try{
    const {operationId:id}=await (await db.submit()).json();let calls=0
    const empty=deps(async()=>{calls++;return new Response('   ')})
    const op=await processRuntimeOperation(db.pool,id,empty)
    assert.equal(op.status,'needs_reconciliation')
    assert.equal((await db.pool.query('SELECT status FROM tool_skill_asset_invocations')).rows[0].status,'needs_reconciliation')
    await processRuntimeOperation(db.pool,id,empty);assert.equal(calls,1)
  }finally{await db.close()}
})
