import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeTestDatabase } from './runtime-test-db.mjs'

test('durable submission is atomic, scoped and body-idempotent', async () => {
  const { enqueueOperation, runtimeWithTransaction } = await import('../netlify/functions/_shared/runtime/ledger.ts')
  const db = await runtimeTestDatabase()
  try {
    const input = { workspaceId: 'synthetic', kind: 'test', idempotencyKey: 'one', input: { b: 2, a: 1 } }
    const submit = value => runtimeWithTransaction(db.pool, c => enqueueOperation(c, value))
    const [a, b] = await Promise.all([submit(input), submit({ ...input, input: { a: 1, b: 2 } })])
    assert.equal(a.id, b.id)
    assert.equal(a.status, 'queued')
    assert.equal((await db.pool.query('SELECT * FROM runtime_event_outbox')).rows.length, 1)
    await assert.rejects(submit({ ...input, input: { a: 2 } }), { status: 409 })
    assert.notEqual((await submit({ ...input, workspaceId: 'other' })).id, a.id)
    await assert.rejects(runtimeWithTransaction(db.pool, async c => {
      await enqueueOperation(c, { ...input, idempotencyKey: 'rollback' }); throw Error('synthetic')
    }))
    assert.equal((await db.pool.query("SELECT * FROM runtime_operations WHERE idempotency_key='rollback'")).rows.length, 0)
  } finally { await db.close() }
})

test('cancel an Agent operation also terminates its persisted Agent run', async () => {
  const {enqueueOperation,runtimeWithTransaction}=await import('../netlify/functions/_shared/runtime/ledger.ts')
  const {controlOperation}=await import('../netlify/functions/_shared/runtime/controls.ts')
  const db=await runtimeTestDatabase()
  try{
    await db.pool.query("INSERT INTO workflow_runs(id,workspace_id,kind,name,agent_id,agent_version,status,input_text,output_text,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at) VALUES('run','a','agent','Test','agent','v1','排队中','','','',0,0,0,0,0,'','','trace-run',now())")
    const op=await runtimeWithTransaction(db.pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'agent.run',idempotencyKey:'cancel-agent',input:{},targetId:'run'}))
    await runtimeWithTransaction(db.pool,c=>controlOperation(c,'a',op.id,'cancel',{reason:'stop'},'actor'))
    const run=(await db.pool.query("SELECT status,completed_at FROM workflow_runs WHERE id='run'")).rows[0]
    assert.equal(run.status,'已取消');assert.ok(run.completed_at)
  }finally{await db.close()}
})

test('uncertain replay needs explicit risk acknowledgement; recovery retains evidence and a new attempt', async () => {
  const { enqueueOperation, runtimeWithTransaction } = await import('../netlify/functions/_shared/runtime/ledger.ts')
  const { executeOperation } = await import('../netlify/functions/_shared/runtime/worker.ts')
  const { controlOperation } = await import('../netlify/functions/_shared/runtime/controls.ts')
  const db = await runtimeTestDatabase()
  try {
    const op = await runtimeWithTransaction(db.pool, c => enqueueOperation(c, { workspaceId: 'a', kind: 'test', idempotencyKey: 'uncertain', input: {} }))
    let calls = 0
    await executeOperation(db.pool, op.id, async (_op, ctx) => ctx.effect('send', {}, async () => { calls++; throw Error('synthetic') }))
    const control = (action, body) => runtimeWithTransaction(db.pool, c => controlOperation(c, 'a', op.id, action, body, 'actor'))
    await assert.rejects(control('requeue', { reason: 'unsafe' }), { status: 409 })
    await assert.rejects(control('reconcile', { decision: 'retry', reason: 'checked' }), { status: 422 })
    await control('reconcile', { decision: 'retry', reason: 'checked', acknowledgeDuplicateRisk: true })
    await executeOperation(db.pool, op.id, async (_op, ctx) => ctx.effect('send', {}, async () => { calls++; return 'confirmed' }))
    assert.equal(calls, 2)
    const effect = (await db.pool.query('SELECT * FROM runtime_effects WHERE operation_id=$1', [op.id])).rows[0]
    assert.equal(effect.attempt, 2); assert.equal(effect.status, 'succeeded')
    assert.equal((await db.pool.query("SELECT * FROM runtime_operation_events WHERE event_type='reconcile.retry'")).rows.length, 1)
  } finally { await db.close() }
})

test('one claimant, no repeat effect after lost acknowledgement, and canceled owner cannot write back', async () => {
  const { enqueueOperation, runtimeWithTransaction } = await import('../netlify/functions/_shared/runtime/ledger.ts')
  const { claimOperation, executeOperation } = await import('../netlify/functions/_shared/runtime/worker.ts')
  const db = await runtimeTestDatabase()
  try {
    const make = key => runtimeWithTransaction(db.pool, c => enqueueOperation(c, { workspaceId: 'a', kind: 'test', input: {}, idempotencyKey: key }))
    const a = await make('claim')
    const claims = await Promise.all([claimOperation(db.pool, a.id), claimOperation(db.pool, a.id)])
    assert.equal(claims.filter(Boolean).length, 1)
    const b = await make('uncertain'); let sends = 0
    await executeOperation(db.pool, b.id, async (_op, ctx) => ctx.effect('send', { fixed: 1 }, async () => { sends++; throw Error('acknowledged then lost') }))
    assert.equal((await db.pool.query('SELECT status FROM runtime_operations WHERE id=$1', [b.id])).rows[0].status, 'needs_reconciliation')
    await executeOperation(db.pool, b.id, async () => { sends++ })
    assert.equal(sends, 1)
    const c = await make('cancel')
    await executeOperation(db.pool, c.id, async (op, ctx) => {
      await db.pool.query("UPDATE runtime_operations SET status='canceled',generation=generation+1 WHERE id=$1", [op.id])
      await assert.rejects(ctx.transaction(client => client.query("INSERT INTO runtime_operation_events(id,operation_id,workspace_id,event_type) VALUES('stale',$1,'a','stale')", [op.id])))
      return { invalid: true }
    })
    assert.equal((await db.pool.query('SELECT status FROM runtime_operations WHERE id=$1', [c.id])).rows[0].status, 'canceled')
    assert.equal((await db.pool.query("SELECT * FROM runtime_operation_events WHERE id='stale'")).rows.length, 0)
  } finally { await db.close() }
})

test('lost wakeups and expired workers are redispatched without unbounded duplicate wakeups',async()=>{
  const {enqueueOperation,runtimeWithTransaction}=await import('../netlify/functions/_shared/runtime/ledger.ts')
  const {dispatchOperationEvents,claimOperation}=await import('../netlify/functions/_shared/runtime/worker.ts')
  const db=await runtimeTestDatabase()
  try{
    const op=await runtimeWithTransaction(db.pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'test',idempotencyKey:'lost',input:{}}))
    let sends=0
    const send=async()=>{sends++;return {sendStatus:'succeeded',eventId:'synthetic'}}
    await dispatchOperationEvents(db.pool,send)
    await db.pool.query("UPDATE runtime_operations SET updated_at=now()-interval '2 minutes' WHERE id=$1",[op.id])
    await dispatchOperationEvents(db.pool,send)
    assert.equal(sends,2,'queued operation with lost accepted event is woken again')
    await dispatchOperationEvents(db.pool,send)
    assert.equal(sends,2,'recovery wakeup is deduplicated within the minute')
    await claimOperation(db.pool,op.id)
    await db.pool.query("UPDATE runtime_operations SET locked_until=now()-interval '1 second' WHERE id=$1",[op.id])
    await dispatchOperationEvents(db.pool,send)
    assert.equal(sends,3,'expired worker gets recovery event')
  }finally{await db.close()}
})

test('canceling an in-flight effect retains a visible reconciliation state',async()=>{
  const {enqueueOperation,runtimeWithTransaction}=await import('../netlify/functions/_shared/runtime/ledger.ts')
  const {executeOperation}=await import('../netlify/functions/_shared/runtime/worker.ts')
  const {controlOperation}=await import('../netlify/functions/_shared/runtime/controls.ts')
  const db=await runtimeTestDatabase()
  try{
    const op=await runtimeWithTransaction(db.pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'test',idempotencyKey:'cancel-flight',input:{}}))
    await executeOperation(db.pool,op.id,async(_op,ctx)=>ctx.effect('send',{},async()=>{
      const canceled=await runtimeWithTransaction(db.pool,c=>controlOperation(c,'a',op.id,'cancel',{reason:'stop'},'actor'))
      assert.equal(canceled.status,'needs_reconciliation','cancel cannot hide an uncertain external effect')
      throw new Error('connection lost')
    }))
    assert.equal((await db.pool.query('SELECT status FROM runtime_operations WHERE id=$1',[op.id])).rows[0].status,'needs_reconciliation')
  }finally{await db.close()}
})

test('late receipt from a canceled attempt cannot overwrite a reconciled new attempt',async()=>{
  const {enqueueOperation,runtimeWithTransaction}=await import('../netlify/functions/_shared/runtime/ledger.ts')
  const {executeOperation}=await import('../netlify/functions/_shared/runtime/worker.ts')
  const {controlOperation}=await import('../netlify/functions/_shared/runtime/controls.ts')
  const db=await runtimeTestDatabase()
  try{
    const op=await runtimeWithTransaction(db.pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'test',idempotencyKey:'late',input:{}}))
    let started,finish
    const signal=new Promise(resolve=>{started=resolve})
    const old=executeOperation(db.pool,op.id,async(_op,ctx)=>ctx.effect('send',{},async()=>{started();return new Promise(resolve=>{finish=resolve})}))
    await signal
    const control=(action,body)=>runtimeWithTransaction(db.pool,c=>controlOperation(c,'a',op.id,action,body,'actor'))
    await control('cancel',{reason:'stop'})
    await control('reconcile',{reason:'checked',decision:'retry',acknowledgeDuplicateRisk:true})
    const current=await executeOperation(db.pool,op.id,async(_op,ctx)=>ctx.effect('send',{},async()=> 'new receipt'))
    assert.equal(current.result,'new receipt')
    finish('late old receipt');await old
    const effect=(await db.pool.query('SELECT * FROM runtime_effects WHERE operation_id=$1',[op.id])).rows[0]
    assert.equal(effect.attempt,2);assert.equal(effect.result,'new receipt')
    assert.equal((await db.pool.query('SELECT result FROM runtime_operations WHERE id=$1',[op.id])).rows[0].result,'new receipt')
  }finally{await db.close()}
})

test('manual terminal failure completes its run and cannot leave schedule overlap stuck',async()=>{
  const {enqueueOperation,runtimeWithTransaction}=await import('../netlify/functions/_shared/runtime/ledger.ts')
  const {controlOperation}=await import('../netlify/functions/_shared/runtime/controls.ts')
  const db=await runtimeTestDatabase()
  try{
    await db.pool.query("INSERT INTO workflow_runs(id,workspace_id,kind,name,status,input_text,output_text,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at) VALUES ('run','a','workflow','Synthetic','运行中','','','',0,0,0,0,0,'','','trace-run',now())")
    const op=await runtimeWithTransaction(db.pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'workflow.run',idempotencyKey:'terminal',input:{},targetId:'run'}))
    await db.pool.query("UPDATE runtime_operations SET status='needs_reconciliation' WHERE id=$1",[op.id])
    await runtimeWithTransaction(db.pool,c=>controlOperation(c,'a',op.id,'reconcile',{reason:'confirmed stopped',decision:'fail'},'actor'))
    const run=(await db.pool.query("SELECT * FROM workflow_runs WHERE id='run'")).rows[0]
    assert.equal(run.status,'失败');assert.ok(run.completed_at)
  }finally{await db.close()}
})

test('bounded recovery does not let already-woken old tasks starve later tasks',async()=>{
  const {enqueueOperation,runtimeWithTransaction}=await import('../netlify/functions/_shared/runtime/ledger.ts')
  const {dispatchOperationEvents}=await import('../netlify/functions/_shared/runtime/worker.ts')
  const db=await runtimeTestDatabase()
  try{
    const make=key=>runtimeWithTransaction(db.pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'test',idempotencyKey:key,input:{}}))
    const first=await make('oldest'),second=await make('later')
    await db.pool.query("UPDATE runtime_event_outbox SET status='sent'")
    await db.pool.query("UPDATE runtime_operations SET updated_at=now()-interval '2 minutes'")
    const sent=[]
    const send=async id=>{sent.push(id);return {sendStatus:'succeeded'}}
    await dispatchOperationEvents(db.pool,send,1)
    await dispatchOperationEvents(db.pool,send,1)
    assert.deepEqual(new Set(sent),new Set([first.id,second.id]))
  }finally{await db.close()}
})

test('canceled parent run fences a prepared human resume before a new external send',async()=>{
  const {enqueueOperation,runtimeWithTransaction}=await import('../netlify/functions/_shared/runtime/ledger.ts')
  const {executeOperation}=await import('../netlify/functions/_shared/runtime/worker.ts')
  const db=await runtimeTestDatabase()
  try{
    await db.pool.query("INSERT INTO workflow_runs(id,workspace_id,kind,name,status,input_text,output_text,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at) VALUES ('run','a','workflow','Synthetic','已取消','','','',0,0,0,0,0,'','','trace-run',now())")
    const op=await runtimeWithTransaction(db.pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'human.resume',idempotencyKey:'canceled-parent',input:{runId:'run'},targetId:'resume-request'}))
    let calls=0
    const result=await executeOperation(db.pool,op.id,async(_op,ctx)=>ctx.effect('send',{},async()=>{calls++;return 'forbidden'}))
    assert.equal(calls,0)
    assert.equal(result.status,'failed')
  }finally{await db.close()}
})

test('terminal business transition is atomic and also runs for claim-stage terminal states',async()=>{
  const {enqueueOperation,runtimeWithTransaction}=await import('../netlify/functions/_shared/runtime/ledger.ts')
  const {executeOperation}=await import('../netlify/functions/_shared/runtime/worker.ts')
  const db=await runtimeTestDatabase()
  try{
    await db.pool.query('CREATE TABLE terminal_projection(id text primary key,status text)')
    const make=key=>runtimeWithTransaction(db.pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'test',idempotencyKey:key,input:{}}))
    const op=await make('atomic-terminal')
    const transition=async(c,o)=>{await c.query('INSERT INTO terminal_projection VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status',[o.id,o.status])}
    await assert.rejects(executeOperation(db.pool,op.id,async()=>{throw Error('business failure')},async(c,o)=>{await transition(c,o);throw Error('projection failure')}),/projection failure/)
    assert.equal((await db.pool.query('SELECT status FROM runtime_operations WHERE id=$1',[op.id])).rows[0].status,'running')
    assert.equal((await db.pool.query('SELECT * FROM terminal_projection')).rows.length,0)
    await db.pool.query("UPDATE runtime_operations SET locked_until=now()-interval '1 second' WHERE id=$1",[op.id])
    await executeOperation(db.pool,op.id,async()=>{throw Error('business failure')},transition)
    assert.equal((await db.pool.query('SELECT status FROM terminal_projection WHERE id=$1',[op.id])).rows[0].status,'failed')
    const uncertain=await make('expired-effect'), exhausted=await make('exhausted')
    await db.pool.query("INSERT INTO runtime_effects(operation_id,effect_key,request_hash,status) VALUES($1,'send','hash','started')",[uncertain.id])
    await db.pool.query('UPDATE runtime_operations SET attempts=max_attempts WHERE id=$1',[exhausted.id])
    for(const [item,status] of [[uncertain,'needs_reconciliation'],[exhausted,'dead_letter']]){
      await executeOperation(db.pool,item.id,async()=>{assert.fail('must not execute')},transition)
      assert.equal((await db.pool.query('SELECT status FROM terminal_projection WHERE id=$1',[item.id])).rows[0].status,status)
    }
  }finally{await db.close()}
})

test('AWL send deadline leaves an unconfirmed wakeup pending instead of hanging the dispatcher',async()=>{
  const {enqueueOperation,runtimeWithTransaction}=await import('../netlify/functions/_shared/runtime/ledger.ts')
  const {dispatchOperationEvents}=await import('../netlify/functions/_shared/runtime/worker.ts')
  const db=await runtimeTestDatabase()
  let guard
  try{
    await runtimeWithTransaction(db.pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'test',idempotencyKey:'send-timeout',input:{}}))
    let release
    const result=await Promise.race([dispatchOperationEvents(db.pool,()=>new Promise(resolve=>{release=resolve}),20,{sendTimeoutMs:15,batchTimeoutMs:40}),new Promise((_,reject)=>{guard=setTimeout(()=>{release({sendStatus:'failed'});reject(new Error('missing send deadline'))},250)})])
    assert.equal(result.sent,0)
    assert.equal((await db.pool.query('SELECT status FROM runtime_event_outbox')).rows[0].status,'pending')
  }finally{clearTimeout(guard);await db.close()}
})
