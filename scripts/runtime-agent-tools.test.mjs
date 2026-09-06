import assert from 'node:assert/strict'
import {runtimeTestDatabase} from './runtime-test-db.mjs'
import {enqueueOperation,runtimeWithTransaction} from '../netlify/functions/_shared/runtime/ledger.ts'
import {executeOperation} from '../netlify/functions/_shared/runtime/worker.ts'
import {prepareAgentToolInput} from '../netlify/functions/_shared/runtime/agent-tools.ts'

const db=await runtimeTestDatabase(),{pool}=db
let checks=0
const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++}
try {
  await pool.query("INSERT INTO tool_skill_assets(id,workspace_id,asset_type,name,description,parameter_schema,adapter_type,adapter_config,status,created_by,created_at,updated_at) VALUES ('tool','a','tool','Lookup','','{}','http','{\"url\":\"https://tools.example.invalid/lookup\",\"method\":\"POST\"}','active','actor',now(),now())")
  const op=await runtimeWithTransaction(pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'workflow.run',idempotencyKey:'tool-test',input:{},targetId:'run',actorId:'actor'}))
  const snapshot={id:'agent',version:'v1',toolAssetRefs:[{assetId:'tool',assetType:'tool',assetName:'Lookup'}],skillAssetRefs:[]}
  let calls=0
  const fetch=async(url,options)=>{calls++;equal(url,'https://tools.example.invalid/lookup','frozen endpoint');equal(JSON.parse(options.body),{input:'hello'},'legacy input parameters');return Response.json({answer:'found'})}
  const result=await executeOperation(pool,op.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,snapshot,'hello','node',{allowedBindings:[{workspaceId:'a',host:'tools.example.invalid'}],fetch}))
  equal(result.status,'succeeded','tool prep completed')
  assert.match(result.result,/Lookup（succeeded）：/);checks++
  equal(calls,1,'one external tool call')
  await pool.query("UPDATE tool_skill_assets SET adapter_config='{\"url\":\"https://evil.example.invalid/changed\",\"method\":\"POST\"}' WHERE id='tool'")
  const resumed=await runtimeWithTransaction(pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'workflow.resume',idempotencyKey:'resume',input:{runId:'run'},targetId:'run',actorId:'actor'}))
  equal((await executeOperation(pool,resumed.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,snapshot,'hello','node',{allowedBindings:[],fetch}))).result,result.result,'finished tool input reused after config changes')
  equal(calls,1,'resume never invokes completed tool')
  await pool.query("UPDATE tool_skill_assets SET adapter_config='{\"url\":\"https://tools.example.invalid/lookup\",\"method\":\"POST\"}' WHERE id='tool'")
  const broken=await runtimeWithTransaction(pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'workflow.run',idempotencyKey:'broken',input:{},targetId:'run2',actorId:'actor'}))
  await pool.query("ALTER TABLE tool_skill_asset_invocations ADD CONSTRAINT synthetic_tool_commit_loss CHECK (node_run_id<>'node2' OR status<>'succeeded') NOT VALID")
  await executeOperation(pool,broken.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,snapshot,'hello','node2',{allowedBindings:[{workspaceId:'a',host:'tools.example.invalid'}],fetch}))
  equal(calls,2,'accepted once before tool invocation commit fails')
  await pool.query('ALTER TABLE tool_skill_asset_invocations DROP CONSTRAINT synthetic_tool_commit_loss')
  const recover=await runtimeWithTransaction(pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'workflow.resume',idempotencyKey:'recover',input:{runId:'run2'},targetId:'run2',actorId:'actor'}))
  await executeOperation(pool,recover.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,snapshot,'hello','node2',{allowedBindings:[{workspaceId:'a',host:'tools.example.invalid'}],fetch}))
  equal(calls,2,'new operation recovers prior effect receipt without second send')
  const makeOp=(key)=>runtimeWithTransaction(pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'workflow.run',idempotencyKey:key,input:{},targetId:key,actorId:'actor'}))
  const options={allowedBindings:[{workspaceId:'a',host:'tools.example.invalid'}]}
  const unknown=await makeOp('unknown')
  let unknownCalls=0
  equal((await executeOperation(pool,unknown.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,snapshot,'hello','unknown-node',{...options,fetch:async()=>{unknownCalls++;throw new Error('accepted then disconnect')}}))).status,'needs_reconciliation','uncertain POST pauses')
  await executeOperation(pool,unknown.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,snapshot,'hello','unknown-node',{...options,fetch}))
  equal(unknownCalls,1,'uncertain original op never auto replays')
  const unknownResume=await runtimeWithTransaction(pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'workflow.resume',idempotencyKey:'unknown-resume',input:{runId:'unknown'},targetId:'unknown',actorId:'actor'}))
  equal((await executeOperation(pool,unknownResume.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,snapshot,'hello','unknown-node',{...options,fetch}))).status,'needs_reconciliation','new resume cannot bypass unresolved original tool')
  equal(calls,2,'new resume never reaches sender')
  equal((await pool.query("SELECT status FROM tool_skill_asset_invocations WHERE node_run_id='unknown-node'")).rows[0].status,'needs_reconciliation','invocation trace exposes uncertainty')
  const denied=await makeOp('denied')
  const deniedResult=await executeOperation(pool,denied.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,snapshot,'hello','denied-node',{allowedBindings:[{workspaceId:'other',host:'tools.example.invalid'}],fetch}))
  assert.match(deniedResult.result,/未获准，未执行/);checks++
  equal(calls,2,'other workspace allowlist cannot grant access')
  const insert=async(id,kind,adapter)=>pool.query("INSERT INTO tool_skill_assets(id,workspace_id,asset_type,name,description,parameter_schema,adapter_type,adapter_config,status,created_by,created_at,updated_at) VALUES ($1,'a',$2,$1,'','{}',$3,'{}','active','actor',now(),now())",[id,kind,adapter])
  await insert('manual','tool','manual');await insert('mcp','tool','mcp');await insert('skill','skill','manual')
  const metadata=await makeOp('metadata'),metadataSnapshot={...snapshot,toolAssetRefs:[{assetId:'manual',assetType:'tool'},{assetId:'mcp',assetType:'tool'}],skillAssetRefs:[{assetId:'skill',assetType:'skill'}]}
  const meta=await executeOperation(pool,metadata.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,metadataSnapshot,'hello','metadata-node',{...options,fetch}))
  assert.match(meta.result,/Manual Tool 仅登记元数据，未执行/);checks++
  assert.match(meta.result,/MCP Tool 网关未配置，未执行/);checks++
  equal((await pool.query("SELECT count(*)::int n FROM tool_skill_asset_invocations WHERE asset_id='skill'")).rows[0].n,0,'Skill metadata is not fabricated execution')
  const foreign=await makeOp('foreign')
  equal((await executeOperation(pool,foreign.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,{...snapshot,toolAssetRefs:[{assetId:'missing-foreign',assetType:'tool'}]},'hello','foreign-node',{...options,fetch}))).status,'failed','missing fixed reference fails closed')
  await pool.query("UPDATE tool_skill_assets SET adapter_config='{\"url\":\"https://tools.example.invalid/lookup\",\"method\":\"GET\"}' WHERE id='tool'")
  const get=await makeOp('get')
  equal((await executeOperation(pool,get.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,snapshot,'a b','get-node',{...options,fetch:async(url,args)=>{equal(new URL(url).searchParams.get('input'),'a b','GET query encoded');equal(args.body,undefined,'GET no body');equal(args.redirect,'error','redirect not followed');assert(args.headers['Idempotency-Key']);checks++;return new Response('plain result')}}))).status,'succeeded','GET transport completes')
  const oversized=await makeOp('oversized')
  equal((await executeOperation(pool,oversized.id,(operation,ctx)=>prepareAgentToolInput(operation,ctx,snapshot,'hello','oversized-node',{...options,fetch:async()=>new Response('x'.repeat(65537))}))).status,'needs_reconciliation','oversize response is not retried as unsent')
  const events=(await pool.query("SELECT details FROM runtime_operation_events WHERE event_type='tool.inputs_frozen'")).rows
  equal(events.some(row=>JSON.stringify(row.details).includes('https://')),false,'public trace does not expose frozen URLs or bodies')
  console.log(JSON.stringify({suite:'runtime-agent-tools',checks,externalNetworkCalls:0}))
} finally {await db.close()}
