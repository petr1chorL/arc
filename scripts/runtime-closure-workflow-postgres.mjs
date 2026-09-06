import assert from 'node:assert/strict'
import {runtimeTestDatabase} from './runtime-test-db.mjs'
import {submitWorkflow,readRun} from '../netlify/functions/_shared/runtime/workflow.ts'
import {processRuntimeOperation} from '../netlify/functions/_shared/runtime/service.ts'
import {runtimeWithTransaction,enqueueOperation} from '../netlify/functions/_shared/runtime/ledger.ts'
import {pauseForReview,mutateHuman} from '../netlify/functions/_shared/runtime-closure/human.ts'
import {createWorkflowEvaluator} from '../netlify/functions/_shared/runtime-closure/evaluation.ts'
import {controlOperation} from '../netlify/functions/_shared/runtime/controls.ts'
const db=await runtimeTestDatabase(),p=db.pool
try {
 await p.query("INSERT INTO users(id,organization_id,display_name,status,is_organization_admin,failed_login_count,created_at,updated_at) VALUES('actor','org','Synthetic','active',false,0,now(),now())")
 await p.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status,created_at,updated_at) VALUES('m','a','actor','operator','active',now(),now())")
 await p.query("INSERT INTO reviewers VALUES('reviewer','a','actor','Synthetic','reviewer',false,true,now())")
 const rubric={id:'rubric',name:'Rubric',judgeType:'llm',judgeModel:'synthetic',modelProviderId:'provider',passScore:80,dimensions:[{id:'quality',name:'quality',weight:100}]}
 await p.query("INSERT INTO model_providers VALUES ('provider','a','Synthetic','openai','https://synthetic.invalid','synthetic','SYNTHETIC','active','actor',now(),now())")
 await p.query("INSERT INTO rubrics(id,workspace_id,name,artifact,dimensions,gate,pass_score,judge_type,judge_model,model_provider_id,status,version,sort_order,created_at,updated_at) VALUES ('rubric','a','Rubric','text',$1,'gate',80,'llm','synthetic','provider','active','v1',0,now(),now())",[JSON.stringify(rubric.dimensions)])
 await p.query("INSERT INTO rubric_versions VALUES('rv','a','rubric','v1',$1,now())",[JSON.stringify(rubric)])
 const snapshot={id:'wf',name:'Human loop',nodes:[{id:'start',type:'trigger',data:{}},{id:'judge',type:'evaluation',data:{rubricRef:{rubricId:'rubric',versionId:'rv',version:'v1',name:'Rubric'}}},{id:'human',type:'human',data:{reviewerIds:['reviewer'],reviewPolicy:'any_one',assignmentType:'direct'}},{id:'end',type:'end',data:{}}],edges:[{id:'e0',source:'start',target:'judge'},{id:'e1',source:'judge',target:'human'},{id:'e2',source:'human',target:'end'}]}
 await p.query("INSERT INTO workflows VALUES('wf','a','Synthetic','已发布','v1.0.0',$1,$2,'{}','{}',now(),now())",[JSON.stringify(snapshot.nodes),JSON.stringify(snapshot.edges)])
 await p.query("INSERT INTO workflow_versions VALUES('wv','a','wf','v1.0.0',$1,'',now())",[JSON.stringify(snapshot)])
 const {operation,run}=await runtimeWithTransaction(p,c=>submitWorkflow(c,{workspaceId:'a',workflowId:'wf',inputText:'original',idempotencyKey:'human-loop',actorId:'actor'}))
 let judgeCalls=0
 const judge=async()=>{judgeCalls++;return{content:JSON.stringify({dimensionScores:[{dimensionId:'quality',score:90,reason:'supported'}],rationale:'acceptable'}),model:'synthetic',usage:{promptTokens:5,completionTokens:3,totalTokens:8},costUsd:0.01}}
 const deps={complete:async()=>{throw Error('unexpected model call')},pauseForReview,evaluateNode:createWorkflowEvaluator(judge)}
 for(let i=0;i<3;i++)await processRuntimeOperation(p,operation.id,deps)
 assert.equal((await p.query('SELECT status FROM runtime_operations WHERE id=$1',[operation.id])).rows[0].status,'waiting_review')
 const task=(await p.query('SELECT * FROM human_tasks WHERE workflow_run_id=$1',[run.id])).rows[0]
 const originalVersion=(await p.query('SELECT content FROM artifact_versions WHERE id=$1',[task.artifact_version_id])).rows[0].content
 assert.equal(JSON.parse(originalVersion).totalScore,90);assert.equal(JSON.parse(originalVersion).passed,true)
 const response=await runtimeWithTransaction(p,c=>mutateHuman(c,'a',task.id,'actor','decisions',{decision:'modify_and_approve',reason:'corrected',artifactVersionId:task.artifact_version_id,idempotencyKey:'human-loop-decision',modifiedContent:'approved revised'}, {enqueue:enqueueOperation}))
 const resumeId=response.body.resumeOperation.operationId
 for(let i=0;i<5;i++)await processRuntimeOperation(p,resumeId,deps)
 const result=await runtimeWithTransaction(p,c=>readRun(c,'a',run.id))
 assert.equal(result.status,'已完成');assert.equal(result.output,'approved revised')
 assert.equal((await p.query('SELECT status FROM runtime_operations WHERE id=$1',[operation.id])).rows[0].status,'succeeded','original waiting operation finishes too')
 assert.equal((await p.query('SELECT status FROM resume_requests WHERE human_task_id=$1',[task.id])).rows[0].status,'succeeded')
 assert.equal(new Set((await p.query('SELECT trace_id FROM node_runs WHERE run_id=$1',[run.id])).rows.map(r=>r.trace_id)).size,1)
 assert.equal((await p.query('SELECT content FROM artifact_versions WHERE id=$1',[task.artifact_version_id])).rows[0].content,originalVersion,'original retained')
 assert.equal(judgeCalls,1);assert.equal(result.costUsd,0.01)
 assert.equal(result.model,'synthetic','end passthrough preserves last real model');assert.equal(result.score,90,'end passthrough preserves evaluation score')
 assert.equal((await p.query('SELECT trace_id FROM evaluations WHERE subject_type=\'node_run\'')).rows[0].trace_id,`trace-${run.id}`)
 const mapped={id:'wf-map',name:'Mapped score',nodes:[snapshot.nodes[0],snapshot.nodes[1],snapshot.nodes[3]],edges:[snapshot.edges[0],{id:'map-edge',source:'judge',target:'end',data:{mappings:[{sourcePath:'$.totalScore',targetPath:'$.score'},{sourcePath:'$.passed',targetPath:'$.passed'}]}}]}
 await p.query("INSERT INTO workflows VALUES('wf-map','a','Mapped','已发布','v1.0.0',$1,$2,'{}','{}',now(),now())",[JSON.stringify(mapped.nodes),JSON.stringify(mapped.edges)])
 await p.query("INSERT INTO workflow_versions VALUES('wv-map','a','wf-map','v1.0.0',$1,'',now())",[JSON.stringify(mapped)])
 const mappingRun=await runtimeWithTransaction(p,c=>submitWorkflow(c,{workspaceId:'a',workflowId:'wf-map',inputText:'score this',idempotencyKey:'mapping',actorId:'actor'}))
 for(let i=0;i<4;i++)await processRuntimeOperation(p,mappingRun.operation.id,deps)
 assert.deepEqual(JSON.parse((await runtimeWithTransaction(p,c=>readRun(c,'a',mappingRun.run.id))).output),{score:90,passed:true})
 const sourceNode=(await p.query("SELECT id FROM node_runs WHERE run_id=$1 AND node_id='start'",[mappingRun.run.id])).rows[0]
 assert.equal((await p.query('SELECT subject_id FROM evaluations WHERE trace_id=$1',[`trace-${mappingRun.run.id}`])).rows[0].subject_id,sourceNode.id)
 for(const timing of ['before-decision','after-decision']) {
  const canceled=await runtimeWithTransaction(p,c=>submitWorkflow(c,{workspaceId:'a',workflowId:'wf',inputText:'cancel me',idempotencyKey:timing,actorId:'actor'}))
  for(let i=0;i<3;i++)await processRuntimeOperation(p,canceled.operation.id,deps)
  const ct=(await p.query('SELECT * FROM human_tasks WHERE workflow_run_id=$1',[canceled.run.id])).rows[0]
  const decide=()=>runtimeWithTransaction(p,c=>mutateHuman(c,'a',ct.id,'actor','decisions',{decision:'approve',reason:'approve',artifactVersionId:ct.artifact_version_id,idempotencyKey:timing},{enqueue:enqueueOperation}))
  let resumed
  if(timing==='after-decision')resumed=await decide()
  await runtimeWithTransaction(p,c=>controlOperation(c,'a',canceled.operation.id,'cancel',{reason:'cancel review run'},'actor'))
  if(timing==='before-decision')await assert.rejects(decide(),e=>e.status===409)
  else for(let i=0;i<5;i++)await processRuntimeOperation(p,resumed.body.resumeOperation.operationId,deps)
  assert.equal((await runtimeWithTransaction(p,c=>readRun(c,'a',canceled.run.id))).status,'已取消','human decision must not resurrect canceled run')
 }
 console.log('runtime closure/workflow PostgreSQL: pause, immutable modification, resume, original operation settlement, trace passed')
} finally {await db.close()}
