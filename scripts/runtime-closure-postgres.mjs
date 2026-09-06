import assert from 'node:assert/strict'
import {runtimeTestDatabase} from './runtime-test-db.mjs'
import {pauseForReview,mutateHuman,humanDetail} from '../netlify/functions/_shared/runtime-closure/human.ts'
import {enqueueOperation,runtimeWithTransaction} from '../netlify/functions/_shared/runtime/ledger.ts'
import {createRuntimeClosureHandler} from '../netlify/functions/_shared/runtime-closure/handler.ts'
import {createPostgresRuntimeClosureBackend} from '../netlify/functions/_shared/runtime-closure/postgres.ts'
import {createIdentityWorkspaceHandler} from '../netlify/functions/_shared/identity-workspace/handler.ts'
import {createPostgresIdentityWorkspaceBackend} from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import {hashPassword} from '../netlify/functions/_shared/identity-workspace/security.ts'
import {refreshHumanSla} from '../netlify/functions/_shared/runtime-closure/sla.ts'
const db=await runtimeTestDatabase(),p=db.pool
async function fixture(table,values) {
 const cols=(await p.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position",[table])).rows
 const record={...values};for(const c of cols)if(!(c.column_name in record)&&c.is_nullable==='NO'&&c.column_default===null)record[c.column_name]=c.data_type.includes('timestamp')?new Date():['integer','double precision','bigint'].includes(c.data_type)?0:c.data_type==='boolean'?false:c.data_type.includes('json')?'[]':''
 const names=Object.keys(record);await p.query(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(record))
}
try {
 for(const id of ['u1','u2']) {await fixture('users',{id,organization_id:'org',status:'active'});await fixture('workspace_memberships',{id:`m${id}`,user_id:id,workspace_id:'w',role:'operator',status:'active'});await fixture('reviewers',{id:`r${id}`,user_id:id,workspace_id:'w',is_active:true})}
 await fixture('workflow_runs',{id:'run',workspace_id:'w',status:'运行中'})
 await fixture('node_runs',{id:'node',run_id:'run',workspace_id:'w'})
 await fixture('artifacts',{id:'art',run_id:'run',source_node_run_id:'node',workspace_id:'w',content:'original'})
 await fixture('artifact_versions',{id:'version',artifact_id:'art',version:1,workspace_id:'w',content:'original'})
 const task=await runtimeWithTransaction(p,c=>pauseForReview(c,{workspaceId:'w',runId:'run',nodeRunId:'node',nodeId:'human',sourceNodeId:'source',artifactVersionId:'version',actorId:'u1',config:{reviewerIds:['ru1','ru2'],reviewPolicy:'all'}}))
 assert.equal(task.status,'待认领')
 const d={decision:'approve',reason:'ok',artifactVersionId:'version',idempotencyKey:'vote1'}
 const vote=(user,body)=>runtimeWithTransaction(p,c=>mutateHuman(c,'w',task.id,user,'decisions',body,{enqueue:enqueueOperation}))
 const duplicate=await Promise.all([vote('u1',d),vote('u1',d)])
 assert.equal(duplicate[0].body.status,'审核中');assert.equal((await p.query('SELECT * FROM review_decisions')).rows.length,1)
 await assert.rejects(vote('u1',{...d,reason:'changed'}),e=>e.status===409)
 const final=await vote('u2',{...d,idempotencyKey:'vote2',decision:'modify_and_approve',modifiedContent:'revised'})
 assert.equal(final.body.resumeOperation.status,'queued');assert.equal(final.body.status,'修改后通过')
 assert.equal((await p.query('SELECT * FROM runtime_operations')).rows.length,1)
 assert.equal((await p.query('SELECT * FROM feedback_candidates')).rows.length,1)
 assert.equal((await p.query("SELECT content FROM artifact_versions WHERE id='version'")).rows[0].content,'original')
 const detail=await runtimeWithTransaction(p,c=>humanDetail(c,'w',task.id));assert.equal(detail.artifactVersions.length,2)
 await assert.rejects(runtimeWithTransaction(p,c=>humanDetail(c,'other',task.id)),e=>e.status===404)
 await fixture('organizations',{id:'org',name:'Synthetic',slug:'synthetic',status:'active'})
 await fixture('workspaces',{id:'w',organization_id:'org',name:'Synthetic',slug:'synthetic',status:'active'})
 const password='Synthetic-only-password!'
 await p.query("UPDATE users SET email='synthetic@example.invalid',normalized_email='synthetic@example.invalid',password_hash=$1 WHERE id='u1'",[await hashPassword(password)])
 const identity=createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(p)),handler=createRuntimeClosureHandler(createPostgresRuntimeClosureBackend(p))
 const login=await identity(new Request('https://synthetic.invalid/api/auth/login',{method:'POST',body:JSON.stringify({email:'synthetic@example.invalid',password})}))
 assert.equal(login.status,200)
 const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),csrf=decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])
 const request=(path,method='GET',body,headers={})=>handler(new Request(`https://synthetic.invalid/api/workspaces/w/${path}`,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,...headers},...(body?{body:JSON.stringify(body)}:{})}))
 const http=await request(`human-tasks/${task.id}`);assert.equal(http.status,200)
 const dto=await http.json();assert.equal(dto.artifact.content,'revised');assert.equal(dto.approvalProgress.received,2);assert.equal(dto.notifications.length,1);assert.equal(dto.auditEvents.length,2)
 assert.equal((await request(`human-tasks/${task.id}/claim`,'POST',{}, {'X-CSRF-Token':''})).status,403)
 assert.equal((await request('reviews/legacy/decision','POST',{decision:'approve'})).status,409)
 for(const path of ['human-tasks','evaluations/overview','evaluations/records','evaluations/regression-runs','evaluations/remediation-tasks','artifacts','observability/overview','observability/human-sla','observability/cost-usage','observability/execution-events','observability/runs/run'])assert.equal((await request(path)).status,200,path)
 assert.equal((await request('artifacts?limit=201')).status,422)
 const setResponse=await request('evaluations/sample-sets','POST',{name:'Synthetic set',description:'test'});assert.equal(setResponse.status,201)
 const set=await setResponse.json()
 const sample=await request(`evaluations/sample-sets/${set.id}/samples`,'POST',{name:'sample',input:'original',expectedOutput:'expected',tags:[' quality ','quality']});assert.equal(sample.status,201);assert.equal((await sample.json()).input,'original')
 const sets=await(await request('evaluations/sample-sets')).json();assert.equal(sets[0].sampleCount,1);assert.deepEqual(sets[0].samples[0].tags,['quality'])
 const totals=(await(await request('observability/overview')).json()).totals;assert.equal(totals.totalRuns,1);assert.equal(typeof totals.failedRuns,'number')
 const observation=await(await request('observability/runs/run')).json();assert.equal(observation.nodes[0].input,'');assert.equal(observation.nodes[0].output,'')
 assert.equal((await(await request('observability/cost-usage')).json()).costConfigured,false)
 const schema={schema:{type:'object',required:['count'],properties:{count:{type:'integer'}}}}
 for(const[content,expected]of[['{"count":1}','passed'],['{"count":true}','failed'],['{"count":1.5}','failed'],['{}','failed'],['bad','failed']])assert.equal((await p.query('SELECT runtime_artifact_schema_status($1,$2::json) status',[content,JSON.stringify(schema)])).rows[0].status,expected)
 await p.query("UPDATE human_tasks SET status='审核中',assignee_reviewer_id='ru1',due_at=now()-interval '2 hours',escalation_at=now()-interval '1 hour' WHERE id=$1",[task.id])
 await Promise.all([runtimeWithTransaction(p,c=>refreshHumanSla(c,'w')),runtimeWithTransaction(p,c=>refreshHumanSla(c,'w'))])
 assert.equal((await p.query('SELECT status,sla_status FROM human_tasks WHERE id=$1',[task.id])).rows[0].sla_status,'已升级')
 assert.equal((await p.query('SELECT count(*)::int n FROM notification_outbox WHERE human_task_id=$1',[task.id])).rows[0].n,4,'one notice per milestone despite concurrent sweeps')
 assert.equal((await runtimeWithTransaction(p,c=>refreshHumanSla(c,'w'))).changed,0)
 await p.query("UPDATE workspace_memberships SET status='inactive' WHERE user_id='u1'")
 assert.equal((await request(`human-tasks/${task.id}`)).status,404)
 console.log('runtime closure PostgreSQL: human countersign, duplicate race, full-body conflict, immutable artifacts and one resume passed')
} finally {await db.close()}
