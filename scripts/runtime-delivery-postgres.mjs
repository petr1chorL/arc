import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createRuntimeDeliveryHandler } from '../netlify/functions/_shared/runtime-delivery/handler.ts'
import { createPostgresRuntimeDeliveryBackend } from '../netlify/functions/_shared/runtime-delivery/postgres.ts'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { enqueueOperation, runtimeWithTransaction } from '../netlify/functions/_shared/runtime/ledger.ts'
import { executeOperation } from '../netlify/functions/_shared/runtime/worker.ts'
import { dispatchNotifications } from '../netlify/functions/_shared/runtime-delivery/notifications.ts'
import { dispatchDueSchedules, executeScheduleTrigger } from '../netlify/functions/_shared/runtime-delivery/schedules.ts'

const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
const port = Number(process.argv[2] ?? process.env.ARC_RUNTIME_TEST_PORT ?? 55432)
assert(Number.isInteger(port) && port > 0 && port < 65536)
const schema = `runtime_delivery_${randomUUID().replaceAll('-','')}`
const connection = {host:'127.0.0.1',port,user:'postgres',database:'arc_identity_test',connectionTimeoutMillis:5000}
const admin = new Pool(connection), pool = new Pool({...connection,options:`-c search_path=${schema}`,statement_timeout:10000})
const identity = createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))
const handler = createRuntimeDeliveryHandler(createPostgresRuntimeDeliveryBackend(pool))
let cookie = '', csrf = '', checks = 0
const equal = (actual,expected,label) => {assert.deepEqual(actual,expected,label); checks++}
const request = (path,method='GET',body,selected=handler,headers={}) => selected(new Request(`https://synthetic.invalid${path}`, {method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,...headers},...(body === undefined ? {} : {body:JSON.stringify(body)})}))
try {
  await admin.query(`CREATE SCHEMA ${schema}`)
  for (const migration of ['20260904060000_create-arc-one-baseline','20260904133000_create-identity-rate-limits','20260906160000_runtime-operations']) await pool.query(readFileSync(new URL(`../netlify/database/migrations/${migration}/migration.sql`,import.meta.url),'utf8'))
  await pool.query("INSERT INTO organizations VALUES ('org','Synthetic','synthetic','active',now(),now())")
  for (const id of ['a','b']) await pool.query("INSERT INTO workspaces (id,organization_id,name,slug,status,created_at,updated_at) VALUES ($1,'org',$1,$1,'active',now(),now())",[id])
  const password = `Synthetic-${randomUUID()}!`
  await pool.query("INSERT INTO users (id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,failed_login_count,created_at,updated_at) VALUES ('actor','org','actor@example.invalid','actor@example.invalid','Synthetic',$1,'active',false,0,now(),now())",[await hashPassword(password)])
  await pool.query("INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status,created_at,updated_at) VALUES ('member','a','actor','workspace_admin','active',now(),now())")
  equal((await request('/api/workspaces/a/schedules')).status,401,'anonymous')
  const login = await request('/api/auth/login','POST',{email:'actor@example.invalid',password},identity)
  equal(login.status,200,'login')
  cookie = login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')
  csrf = decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])
  const response = await request('/api/workspaces/a/notification-channels','POST',{name:'Inbox',channelType:'in_app'})
  equal(response.status,200,'create channel')
  const channel=await response.json()
  equal(channel.name,'Inbox','channel body')
  equal((await request('/api/workspaces/b/notification-channels')).status,404,'workspace isolation')
  equal((await request('/api/workspaces/a/notification-channels','POST',{name:'Inbox',channelType:'in_app'})).status,409,'duplicate channel')
  equal((await request(`/api/workspaces/a/notification-channels/${channel.id}/disable`,'POST')).status,200,'disable')
  equal((await request(`/api/workspaces/a/notification-channels/${channel.id}/enable`,'POST')).status,200,'enable')
  equal((await request('/api/workspaces/a/notification-channels','POST',{name:'secret',channelType:'email',config:{nested:{token:'synthetic'}}})).status,422,'nested credentials rejected')
  equal((await request('/api/workspaces/a/notifications/outbox/dispatch','POST',undefined,handler,{'X-CSRF-Token':'wrong','Idempotency-Key':'csrf'})).status,403,'CSRF denied')
  await pool.query("UPDATE workspace_memberships SET role='viewer' WHERE id='member'")
  equal((await request('/api/workspaces/a/notification-channels')).status,403,'channel admin role')
  equal((await request('/api/workspaces/a/schedules')).status,200,'viewer reads schedules')
  await pool.query("UPDATE workspace_memberships SET role='workspace_admin' WHERE id='member'")
  const graph={id:'w',name:'Workflow',nodes:[],edges:[]}
  await pool.query("INSERT INTO workflows(id,workspace_id,name,status,version,nodes,edges,input_schema,output_schema,created_at,updated_at) VALUES ('w','a','Workflow','已发布','v1','[]','[]','{}','{}',now(),now())")
  await pool.query("INSERT INTO workflow_versions(id,workspace_id,workflow_id,version,snapshot,note,created_at) VALUES ('version','a','w','v1',$1,'',now())",[JSON.stringify(graph)])
  const payload={name:'Daily',workflowId:'w',workflowVersion:'v1',cronExpression:'*/5 * * * *',timezone:'Asia/Shanghai',input:'{}'}
  const created=await request('/api/workspaces/a/schedules','POST',payload)
  equal(created.status,201,'create schedule')
  const schedule=await created.json(), path=`/api/workspaces/a/schedules/${schedule.id}`
  equal([schedule.workflowVersionId,schedule.status,schedule.workflowName],['version','active','Workflow'],'pinned published version')
  equal((await request('/api/workspaces/a/schedules','POST',payload)).status,409,'duplicate schedule')
  equal((await request('/api/workspaces/a/schedules','POST',{...payload,name:'invalid',timezone:'Bad/Timezone'})).status,422,'bad timezone')
  equal((await request(path,'PATCH',{input:'{'})).status,422,'input JSON syntax')
  equal((await (await request(`${path}/pause`,'POST')).json()).nextRunAt,null,'pause removes next run')
  equal((await (await request(`${path}/resume`,'POST')).json()).status,'active','resume')
  equal((await request(`/api/workspaces/b/schedules/${schedule.id}`,'PATCH',{name:'foreign'})).status,404,'schedule tenant isolation')
  let enqueueCalls=0
  const enqueueRun=async(client,args)=>{
    enqueueCalls++
    const runId=randomUUID()
    await client.query("INSERT INTO workflow_runs(id,workspace_id,kind,name,workflow_id,workflow_version,status,input_text,output_text,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at) VALUES ($1,'a','workflow','Synthetic','w','v1','排队中','{}','','',0,0,0,0,0,'','',$2,now())",[runId,`trace-${runId}`])
    const operation=await enqueueOperation(client,{workspaceId:args.workspaceId,kind:'workflow.run',idempotencyKey:args.idempotencyKey,input:{version:args.version,input:args.inputText},targetId:runId,actorId:args.actorId})
    return {run:{id:runId},operation}
  }
  const instant=new Date('2026-09-06T10:11:00Z')
  await pool.query('UPDATE workflow_schedules SET next_run_at=$1 WHERE id=$2',[new Date('2026-09-06T10:00Z'),schedule.id])
  const race=await Promise.all([dispatchDueSchedules(pool,enqueueRun,instant),dispatchDueSchedules(pool,enqueueRun,instant)])
  equal(race.flat().length,1,'concurrent due only one slot')
  equal(enqueueCalls,1,'one run submission')
  equal((await pool.query('SELECT next_run_at FROM workflow_schedules WHERE id=$1',[schedule.id])).rows[0].next_run_at.toISOString(),'2026-09-06T10:15:00.000Z','missed cycles skipped')
  await dispatchDueSchedules(pool,enqueueRun,new Date('2026-09-06T10:16Z'))
  equal(enqueueCalls,1,'overlap does not create run')
  equal((await pool.query("SELECT count(*)::int n FROM schedule_dispatches WHERE status='skipped'")).rows[0].n,1,'overlap explicit skipped')
  const trigger=await request(`${path}/trigger`,'POST',undefined,handler,{'Idempotency-Key':'manual'})
  equal(trigger.status,202,'manual durable async')
  const manual=await trigger.json()
  equal((await (await request(`${path}/trigger`,'POST',undefined,handler,{'Idempotency-Key':'manual'})).json()).operationId,manual.operationId,'manual idempotency')
  await executeOperation(pool,manual.operationId,(op,ctx)=>executeScheduleTrigger(op,ctx,enqueueRun))
  equal((await request(`${path}/dispatches`)).status,200,'dispatch history')
  await pool.query("INSERT INTO notification_channels(id,workspace_id,name,channel_type,status,config,secret_ref,created_by,created_at,updated_at) VALUES ('email','a','Email','email','active','{}','','actor',now(),now())")
  const add=async(id,channel='in_app')=>pool.query("INSERT INTO notification_outbox(id,workspace_id,event_key,human_task_id,event_type,recipient_type,recipient_id,payload,status,created_at) VALUES ($1,'a',$1,'task','review','reviewer','actor',$2,'pending',now())",[id,JSON.stringify({channel,traceId:'trace-test'})])
  const newOperation=async(key,limit=20)=>runtimeWithTransaction(pool,c=>enqueueOperation(c,{workspaceId:'a',kind:'notification.dispatch',idempotencyKey:key,input:{limit},actorId:'actor'}))
  await add('in-app')
  const inApp=await newOperation('in-app')
  equal((await executeOperation(pool,inApp.id,(op,ctx)=>dispatchNotifications(op,ctx))).result.sent,1,'in app persisted delivery')
  equal((await pool.query("SELECT payload->'dispatch'->>'deliveryKind' kind FROM notification_outbox WHERE id='in-app'")).rows[0].kind,'persistent_in_app','does not claim external send')
  await add('external','email')
  let sends=0
  const external=await newOperation('external')
  await executeOperation(pool,external.id,(op,ctx)=>dispatchNotifications(op,ctx,{email:async()=>{sends++;throw new Error('Synthetic remote accepted then disconnected')}}))
  equal(sends,1,'one uncertain external attempt')
  equal((await pool.query('SELECT status FROM runtime_operations WHERE id=$1',[external.id])).rows[0].status,'needs_reconciliation','uncertainty durable')
  await executeOperation(pool,external.id,(op,ctx)=>dispatchNotifications(op,ctx,{email:async()=>{sends++;return {status:'sent'}}}))
  const other=await newOperation('other')
  await executeOperation(pool,other.id,(op,ctx)=>dispatchNotifications(op,ctx,{email:async()=>{sends++;return {status:'sent'}}}))
  equal(sends,1,'same event or other batch cannot resend uncertain')
  equal((await (await request('/api/workspaces/a/notifications/outbox?status=needs_reconciliation')).json()).length,1,'query uncertainty')
  equal((await request('/api/workspaces/a/notifications/outbox/external/requeue','POST',{reason:'retry'})).status,409,'ordinary requeue cannot bypass uncertainty')
  await add('missing','feishu')
  const missing=await newOperation('missing')
  equal((await executeOperation(pool,missing.id,(op,ctx)=>dispatchNotifications(op,ctx))).result.failed,1,'unconfigured real channel explicit failure')
  equal((await request('/api/workspaces/a/notifications/outbox/missing/requeue','POST',{reason:'configured'})).status,200,'confirmed failure requeue')
  await pool.query("UPDATE notification_outbox SET status='failed' WHERE id='missing'")
  await add('commit-loss','email')
  const commitLoss=await newOperation('commit-loss')
  let accepted=0
  await pool.query("ALTER TABLE notification_outbox ADD CONSTRAINT synthetic_commit_loss CHECK (id<>'commit-loss' OR status<>'sent') NOT VALID")
  await executeOperation(pool,commitLoss.id,(op,ctx)=>dispatchNotifications(op,ctx,{email:async()=>{accepted++;return {status:'sent',providerMessageId:'receipt-1'}}}))
  equal(accepted,1,'receiver acknowledged once before business commit fails')
  equal((await pool.query("SELECT status FROM runtime_effects WHERE operation_id=$1",[commitLoss.id])).rows[0].status,'succeeded','effect receipt durable before business write')
  await pool.query('ALTER TABLE notification_outbox DROP CONSTRAINT synthetic_commit_loss')
  // Simulate controlled recovery from a failed local checkpoint, not an uncertain external replay.
  await pool.query("UPDATE runtime_operations SET status='queued',available_at=now() WHERE id=$1",[commitLoss.id])
  await executeOperation(pool,commitLoss.id,(op,ctx)=>dispatchNotifications(op,ctx,{email:async()=>{accepted++;return {status:'sent'}}}))
  equal(accepted,1,'cached receipt recovery does not send twice')
  equal((await pool.query("SELECT status FROM notification_outbox WHERE id='commit-loss'")).rows[0].status,'sent','receipt safely advances business state')
  await add('race-send','email')
  const firstBatch=await newOperation('race1'),secondBatch=await newOperation('race2')
  let raceSends=0
  const deliver=async()=>{raceSends++;return {status:'sent',providerMessageId:'race'}}
  await Promise.all([executeOperation(pool,firstBatch.id,(op,ctx)=>dispatchNotifications(op,ctx,{email:deliver})),executeOperation(pool,secondBatch.id,(op,ctx)=>dispatchNotifications(op,ctx,{email:deliver}))])
  equal(raceSends,1,'parallel batches only one recipient call')
  for(let index=0;index<7;index++)await add(`batch-${index}`)
  const bounded=await newOperation('bounded')
  equal((await executeOperation(pool,bounded.id,(op,ctx)=>dispatchNotifications(op,ctx))).status,'queued','bounded batch yields after five')
  equal((await pool.query("SELECT count(*)::int n FROM notification_outbox WHERE id LIKE 'batch-%' AND status='sent'")).rows[0].n,5,'only five progressed')
  equal((await executeOperation(pool,bounded.id,(op,ctx)=>dispatchNotifications(op,ctx))).result.sent,7,'continuation aggregates whole fixed batch')
  equal((await request(path,'PATCH',{name:'Updated',cronExpression:'0 * * * *'})).status,200,'edit schedule')
  await pool.query('UPDATE workflow_runs SET completed_at=now()')
  const frozen=await (await request(`${path}/trigger`,'POST',undefined,handler,{'Idempotency-Key':'frozen'})).json()
  await request(path,'PATCH',{input:'{"changed":true}'})
  let frozenInput
  await executeOperation(pool,frozen.operationId,(op,ctx)=>executeScheduleTrigger(op,ctx,async(c,args)=>{frozenInput=args.inputText;return enqueueRun(c,args)}))
  equal(frozenInput,'{}','manual submission preserves accepted schedule input')
  await pool.query("INSERT INTO notification_channels(id,workspace_id,name,channel_type,status,config,secret_ref,created_by,created_at,updated_at) VALUES ('old-disabled','a','Old disabled email','email','disabled','{}','','actor','2020-01-01',now())")
  await add('active-channel','email')
  const activeChannel=await newOperation('active-channel')
  let selectedChannel
  const selection=await executeOperation(pool,activeChannel.id,(op,ctx)=>dispatchNotifications(op,ctx,{email:async({channel})=>{selectedChannel=channel.name;return {status:'sent',providerMessageId:'active-receipt'}}}))
  equal(selection.result.sent,1,'older disabled channel cannot hide an active channel')
  equal(selectedChannel,'Email','active channel selected before older disabled record')
  await pool.query("UPDATE notification_channels SET status='disabled' WHERE channel_type='email' AND workspace_id='a'")
  await add('disabled-only','email')
  const disabledOnly=await newOperation('disabled-only')
  let disabledCalls=0
  const disabledResult=await executeOperation(pool,disabledOnly.id,(op,ctx)=>dispatchNotifications(op,ctx,{email:async()=>{disabledCalls++;return {status:'sent'}}}))
  equal(disabledResult.result.items[0].errorCode,'channel_disabled','all disabled channels preserve explicit disabled failure')
  equal(disabledCalls,0,'disabled channel never enters adapter')
  console.log(JSON.stringify({suite:'runtime-delivery-postgres',checks,externalNetworkCalls:0,schemaIsolated:true}))
} finally {
  await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  await admin.end()
}
