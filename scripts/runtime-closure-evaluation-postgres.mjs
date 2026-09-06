import assert from 'node:assert/strict'
import {runtimeTestDatabase} from './runtime-test-db.mjs'
import {enqueueEvaluation,enqueueRegression,createClosureExecutor,createGatewayJudgeTransport} from '../netlify/functions/_shared/runtime-closure/evaluation.ts'
import {runtimeWithTransaction} from '../netlify/functions/_shared/runtime/ledger.ts'
import {ContinueOperation} from '../netlify/functions/_shared/runtime/types.ts'
import {remediation} from '../netlify/functions/_shared/runtime-closure/remediation.ts'
import {readClosure} from '../netlify/functions/_shared/runtime-closure/queries.ts'
const db=await runtimeTestDatabase(),p=db.pool
try {
 const snapshot={id:'rubric',name:'Rubric',version:'v1',judgeType:'llm',judgeModel:'synthetic',modelProviderId:'provider',passScore:80,dimensions:[{id:'quality',name:'quality',weight:100}]}
 await p.query("INSERT INTO model_providers VALUES ('provider','w','Synthetic','openai','https://synthetic.invalid','synthetic','SYNTHETIC','active','actor',now(),now())")
 await p.query("INSERT INTO rubrics(id,workspace_id,name,artifact,dimensions,gate,pass_score,judge_type,judge_model,model_provider_id,status,version,sort_order,created_at,updated_at) VALUES ('rubric','w','Rubric','text',$1,'gate',80,'llm','synthetic','provider','active','v1',0,now(),now())",[JSON.stringify(snapshot.dimensions)])
 await p.query("INSERT INTO rubric_versions VALUES('rv','w','rubric','v1',$1,now())",[JSON.stringify(snapshot)])
 const op=await runtimeWithTransaction(p,c=>enqueueEvaluation(c,'w','rubric',{artifactText:'text',subjectType:'artifact'},'actor','first'))
 let sends=0;const saved=new Map()
 const ctx={pool:p,transaction:fn=>runtimeWithTransaction(p,fn),effect:async(key,input,send)=>{if(!saved.has(key))saved.set(key,await send());return saved.get(key)}}
 const executor=createClosureExecutor({judge:async(req)=>{sends++;assert.equal(req.model,'synthetic');return{content:JSON.stringify({dimensionScores:[{dimensionId:'quality',score:90,reason:'grounded'}],rationale:'supported'}),model:'synthetic',usage:{promptTokens:5,completionTokens:5,totalTokens:10},costUsd:0.01}}})
 const result=await executor(op,ctx);assert.equal(result.score,90);assert.equal(result.costUsd,0.01)
 assert.equal((await executor(op,ctx)).id,result.id);assert.equal(sends,1)
 const batch=await runtimeWithTransaction(p,c=>enqueueRegression(c,'w',{rubricId:'rubric',samples:[{input:'one'},{input:'two'}]},'actor','batch'))
 await assert.rejects(executor(batch,ctx),e=>e instanceof ContinueOperation)
 let row=(await p.query('SELECT * FROM regression_runs WHERE id=$1',[batch.id])).rows[0];assert.equal(row.status,'running');assert.equal(row.completed_at,null);assert.equal(row.passed_samples,1)
 await assert.rejects(executor(batch,ctx),e=>e instanceof ContinueOperation)
 const final=await executor(batch,ctx);assert.equal(final.status,'completed');assert.equal(final.records.length,2)
 const rem=(id,operation,body={},key='retest')=>runtimeWithTransaction(p,c=>remediation(c,'w',id,'actor','Synthetic',operation,body,()=>key))
 const task=(await rem('','remediation.create',{sourceRunId:batch.id,clusterKey:'quality',title:'Fix quality',priority:'P1',sampleIds:[final.records[0].id],action:'Improve quality'})).body
 assert.equal(task.status,'open')
 await assert.rejects(rem(task.id,'remediation.action.retest'),e=>e.status===409)
 await rem(task.id,'remediation.update',{status:'done'})
 const retest=await rem(task.id,'remediation.action.retest');assert.equal(retest.status,202)
 const rop=(await p.query('SELECT * FROM runtime_operations WHERE id=$1',[retest.body.operationId])).rows[0]
 assert.equal(rop.input.samples[0].input,'one','retest original artifact, not rerun agent')
 assert.equal((await rem(task.id,'remediation.action.retest')).body.operationId,rop.id,'duplicate retest reused')
 const fail=createClosureExecutor({judge:async()=>({content:JSON.stringify({dimensionScores:[{dimensionId:'quality',score:10,reason:'still incorrect'}],rationale:'failed'}),model:'synthetic',usage:{promptTokens:1,completionTokens:1,totalTokens:2},costUsd:0})})
 await assert.rejects(fail(rop,ctx),e=>e instanceof ContinueOperation)
 await fail(rop,ctx)
 assert.equal((await rem(task.id,'remediation.detail')).body.status,'in_progress','failed retest reopens remediation')
 await p.query("UPDATE runtime_operations SET status='failed' WHERE id=$1",[rop.id])
 assert.equal((await runtimeWithTransaction(p,c=>readClosure(c,'w','','regression.list',new URLSearchParams()))).find(r=>r.id===rop.id).status,'failed','list and detail agree on operation failure')
 assert.equal((await rem(task.id,'remediation.detail')).body.retestSummary.status,'failed')
 await rem(task.id,'remediation.update',{status:'done'})
 const retry=await rem(task.id,'remediation.action.retest',{},'second-retest');assert.notEqual(retry.body.operationId,rop.id)
 await p.query("UPDATE runtime_operations SET status='needs_reconciliation' WHERE id=$1",[retry.body.operationId])
 await assert.rejects(rem(task.id,'remediation.update',{status:'in_progress'}),e=>e.status===409)
 await assert.rejects(rem(task.id,'remediation.action.retest',{},'bypass-uncertain'),e=>e.status===409)
 await p.query("UPDATE runtime_operations SET status='canceled' WHERE id=$1",[retry.body.operationId])
 const afterCancel=await rem(task.id,'remediation.action.retest',{},'after-cancel');assert.notEqual(afterCancel.body.operationId,retry.body.operationId)
 await assert.rejects(runtimeWithTransaction(p,c=>enqueueEvaluation(c,'foreign','rubric',{artifactText:'text',subjectType:'artifact'},'actor','foreign')),e=>e.status===409)
 await assert.rejects(runtimeWithTransaction(p,c=>enqueueEvaluation(c,'w','rubric',{artifactText:'text',subjectType:'artifact',subjectId:'foreign-artifact'},'actor','foreign-subject')),e=>e.status===422)
 let realCalls=0;const gateway=createGatewayJudgeTransport(p,async()=>{realCalls++;throw Error('must not send')})
 await p.query("UPDATE model_providers SET base_url='https://changed.invalid' WHERE id='provider'")
 await assert.rejects(gateway({workspaceId:'w',providerId:'provider',providerBindingHash:op.input.snapshot.providerBindingHash,model:'synthetic',messages:[],responseFormat:{type:'json_object'}}),e=>e.constructor.name==='NotSentError')
 assert.equal(realCalls,0)
 await p.query("UPDATE rubric_versions SET snapshot=$1 WHERE id='rv'",[JSON.stringify({...snapshot,judgeType:'deterministic',modelProviderId:null,judgeModel:''})])
 const deterministic=await runtimeWithTransaction(p,c=>enqueueEvaluation(c,'w','rubric',{artifactText:'source evidence',subjectType:'text'},'actor','deterministic'))
 const before=sends,dr=await executor(deterministic,ctx);assert.equal(dr.evaluatorType,'deterministic');assert.equal(dr.score,51);assert.equal(dr.costUsd,0);assert.equal(sends,before,'heuristic never calls judge')
 console.log('runtime closure evaluation PostgreSQL: immutable rubric, actual adapter parse/cost, replay, incremental batch, workspace isolation passed; synthetic transport only')
} finally {await db.close()}
