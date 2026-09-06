import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeTestDatabase } from './runtime-test-db.mjs'
test('fixed-version workflow advances bounded checkpoints and persists run/node/artifact results', async () => {
  const { submitWorkflow, createWorkflowExecutor, readRun } = await import('../netlify/functions/_shared/runtime/workflow.ts')
  const { runtimeWithTransaction } = await import('../netlify/functions/_shared/runtime/ledger.ts')
  const { executeOperation } = await import('../netlify/functions/_shared/runtime/worker.ts')
  const db = await runtimeTestDatabase()
  try {
    const snapshot = { id: 'wf', name: 'Synthetic', nodes: [
      { id: 'start', type: 'trigger', data: {} }, { id: 'end', type: 'end', data: {} }], edges: [{ id: 'e', source: 'start', target: 'end' }] }
    await db.pool.query("INSERT INTO workflows VALUES('wf','a','Synthetic','已发布','v1.0.0',$1,$2,'{}','{}',now(),now())", [JSON.stringify(snapshot.nodes), JSON.stringify(snapshot.edges)])
    await db.pool.query("INSERT INTO workflow_versions VALUES('wv','a','wf','v1.0.0',$1,'',now())", [JSON.stringify(snapshot)])
    const { operation, run } = await runtimeWithTransaction(db.pool, c => submitWorkflow(c, {
      workspaceId: 'a', workflowId: 'wf', inputText: 'synthetic input', idempotencyKey: 'request', actorId: 'actor' }))
    assert.equal(run.status, '排队中')
    const executor = createWorkflowExecutor({ complete: async () => { throw Error('unexpected model call') } })
    const failures = []
    for (let i = 0; i < 4; i++) await executeOperation(db.pool, operation.id, async (...args) => {
      try { return await executor(...args) } catch (error) { if (error.constructor.name !== 'ContinueOperation') failures.push(error); throw error }
    })
    assert.equal(failures.length, 0, failures.map(error => error.stack).join('\n'))
    const result = await runtimeWithTransaction(db.pool, c => readRun(c, 'a', run.id))
    assert.equal(result.status, '已完成'); assert.equal(result.output, 'synthetic input'); assert.equal(result.nodes.length, 2)
    assert.equal((await db.pool.query('SELECT * FROM artifact_versions')).rows.length, 2)
    await executeOperation(db.pool, operation.id, executor)
    assert.equal((await db.pool.query('SELECT * FROM node_runs')).rows.length, 2)
    await assert.rejects(runtimeWithTransaction(db.pool, c => readRun(c, 'b', run.id)), { status: 404 })
  } finally { await db.close() }
})

test('direct Agent test run uses a fixed publication and persists actual adapter metrics', async () => {
  const { submitAgent, createAgentExecutor, readRun } = await import('../netlify/functions/_shared/runtime/workflow.ts')
  const { runtimeWithTransaction } = await import('../netlify/functions/_shared/runtime/ledger.ts')
  const { executeOperation } = await import('../netlify/functions/_shared/runtime/worker.ts')
  const db=await runtimeTestDatabase()
  try {
    const snapshot={id:'agent',name:'Test Agent',model:'synthetic',modelProviderId:'provider',modelBaseUrl:'https://model.example.invalid/v1',systemPrompt:'system',role:'role',runtimeManifest:{},temperature:0.2,maxOutputTokens:200}
    await db.pool.query("INSERT INTO agent_versions VALUES('av','a','agent','v1.0.0',$1,'',now())",[JSON.stringify(snapshot)])
    await db.pool.query(`INSERT INTO agents(id,workspace_id,name,role,owner,model,model_provider,model_base_url,temperature,max_output_tokens,status,version,pass_rate,runs,tools,skills,tool_asset_refs,skill_asset_refs,system_prompt,runtime_manifest,created_at,updated_at)
      VALUES('agent','a','Synthetic','','','synthetic','','',0,100,'在线','v1.0.0',0,0,'[]','[]','[]','[]','','{}',now(),now())`)
    await db.pool.query("UPDATE agents SET status='已停用' WHERE id='agent'")
    await assert.rejects(runtimeWithTransaction(db.pool,c=>submitAgent(c,{workspaceId:'a',agentId:'agent',inputText:'hello',idempotencyKey:'disabled',actorId:'actor'})),{status:409})
    await db.pool.query("UPDATE agents SET status='在线' WHERE id='agent'")
    await db.pool.query("INSERT INTO model_providers VALUES('provider','a','Synthetic','openai_compatible','https://model.example.invalid/v1','synthetic','TEST_REF','active','actor',now(),now())")
    const {operation,run}=await runtimeWithTransaction(db.pool,c=>submitAgent(c,{workspaceId:'a',agentId:'agent',version:'v1.0.0',inputText:'hello',idempotencyKey:'agent-key',actorId:'actor'}))
    let calls=0
    await executeOperation(db.pool,operation.id,createAgentExecutor({complete:async request=>{
      calls++;assert.equal(request.userInput,'hello');return{content:'actual controlled response',model:'synthetic',promptTokens:4,completionTokens:6,costUsd:0.01}
    }}))
    const result=await runtimeWithTransaction(db.pool,c=>readRun(c,'a',run.id))
    assert.equal(result.kind,'agent');assert.equal(result.status,'已完成');assert.equal(result.totalTokens,10);assert.equal(result.costUsd,0.01)
    assert.equal(result.output,'actual controlled response');assert.equal(calls,1)
  }finally{await db.close()}
})
