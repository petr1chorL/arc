import {randomUUID} from 'node:crypto'
import {ApiError} from '../identity-workspace/handler.ts'
import type {SqlClient} from '../identity-workspace/postgres.ts'
import {enqueueRegression,regressionDetail} from './evaluation.ts'
import {project,text} from './policy.ts'
import type {Row} from './types.ts'
import {projectOperation} from '../runtime/ledger.ts'
import type {Operation} from '../runtime/types.ts'

async function detail(c:SqlClient,ws:string,id:string) {
 const row=(await c.query('SELECT * FROM remediation_tasks WHERE workspace_id=$1 AND id=$2',[ws,id])).rows[0];if(!row)throw new ApiError(404,'整改任务不存在')
 const retest=row.retest_run_id?await regressionDetail(c,ws,String(row.retest_run_id)):null
 const pending=retest&&['queued','running','waiting_review'].includes(String(retest.status)),uncertain=retest?.status==='needs_reconciliation',passed=retest&&retest.status==='completed'&&retest.failedSamples===0
 return {...project(row),isOverdue:!!row.due_date&&new Date(String(row.due_date))<new Date()&&row.status!=='done',retestRun:retest,
  retestSummary:{status:uncertain?'needs_reconciliation':pending?'pending':passed?'passed':retest?'failed':'not_started',label:uncertain?'结果待核对':pending?'复测中':passed?'复测通过':retest?'复测未通过':'未复测',recommendation:uncertain?'必须先核对外部调用，不可新建复测绕过核对':passed?'保留复测证据':'完成整改后复测原产出物',runId:row.retest_run_id??null,failedSamples:retest?.failedSamples??0,passRate:retest?.passRate??null},
  activities:(await c.query('SELECT * FROM remediation_task_activities WHERE workspace_id=$1 AND task_id=$2 ORDER BY created_at,id LIMIT 200',[ws,id])).rows.map(project)}
}
/** Remediation remains a re-score of original artifacts, never an implicit Agent rerun. */
export async function remediation(c:SqlClient,ws:string,id:string,user:string,name:string,operation:string,body:Row,key?:()=>string) {
 if(operation==='remediation.list')return{body:await Promise.all((await c.query('SELECT id FROM remediation_tasks WHERE workspace_id=$1 ORDER BY updated_at DESC,id LIMIT 200',[ws])).rows.map(r=>detail(c,ws,String(r.id))))}
 if(operation==='remediation.create') {
  const source=text(body.sourceRunId,36),cluster=text(body.clusterKey,120),title=text(body.title,200),action=text(body.action),priority=text(body.priority,8)
  if(!/^P[0-2]$/.test(priority)||!Array.isArray(body.sampleIds)||!body.sampleIds.length||body.sampleIds.length>20)throw new ApiError(422,'整改请求无效')
  const run=await regressionDetail(c,ws,source),sampleIds=[...new Set(body.sampleIds.map(s=>text(s,120)))]
  const records=run.records as Row[]
  if(sampleIds.some(s=>!records.some(r=>r.id===s||r.subjectId===s)))throw new ApiError(422,'整改样本不属于来源回归运行')
  const old=(await c.query('SELECT * FROM remediation_tasks WHERE workspace_id=$1 AND source_run_id=$2 AND cluster_key=$3',[ws,source,cluster])).rows[0]
  if(old)return{body:await detail(c,ws,String(old.id))}
  id=randomUUID()
  await c.query("INSERT INTO remediation_tasks(id,workspace_id,source_run_id,cluster_key,title,priority,sample_ids,action,status,owner,due_date,created_by,updated_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,$11,now(),now())",[id,ws,source,cluster,title,priority,JSON.stringify(sampleIds),action,body.owner==null?null:text(body.owner,120),date(body.dueDate),user])
  await activity(c,ws,id,user,name,'created','创建整改任务',[])
  return{status:201,body:await detail(c,ws,id)}
 }
 const task=(await c.query('SELECT * FROM remediation_tasks WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[ws,id])).rows[0];if(!task)throw new ApiError(404,'整改任务不存在')
 if(operation==='remediation.update') {
  if(!Object.keys(body).length||Object.keys(body).some(k=>!['status','owner','priority','dueDate'].includes(k)))throw new ApiError(422,'整改更新字段无效')
  const status=body.status??task.status,priority=body.priority??task.priority
  if(!['open','in_progress','done'].includes(String(status))||!/^P[0-2]$/.test(String(priority)))throw new ApiError(422,'整改状态无效')
  if(task.retest_run_id) {const rr=await regressionDetail(c,ws,String(task.retest_run_id));if(['queued','running','waiting_review','needs_reconciliation'].includes(String(rr.status)))throw new ApiError(409,'复测进行中或结果待核对，不能修改整改任务')}
  await c.query('UPDATE remediation_tasks SET status=$1::varchar,priority=$2,owner=$3,due_date=$4,updated_by=$5,updated_at=now(),retest_run_id=CASE WHEN status<>$1::varchar AND $1::varchar=\'done\' THEN NULL ELSE retest_run_id END WHERE workspace_id=$6 AND id=$7',[status,priority,'owner'in body?body.owner==null?null:text(body.owner,120):task.owner,'dueDate'in body?date(body.dueDate):task.due_date,user,ws,id])
  await activity(c,ws,id,user,name,'updated',JSON.stringify({status,priority}),[])
 } else if(operation==='remediation.action.activities') {
  const refs=body.attachmentRefs??[];if(!Array.isArray(refs)||refs.length>10)throw new ApiError(422,'附件引用无效')
  await activity(c,ws,id,user,name,'comment',text(body.body),refs.map(r=>text(r,500)))
 } else if(operation==='remediation.action.retest') {
  if(task.status!=='done')throw new ApiError(409,'完成整改后才能复测')
  if(task.retest_run_id){const op=(await c.query<Operation>('SELECT * FROM runtime_operations WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[ws,task.retest_run_id])).rows[0];if(!op)throw new ApiError(409,'历史复测任务需要治理');
   if(op.status==='needs_reconciliation'||(await c.query("SELECT 1 FROM runtime_effects WHERE operation_id=$1 AND status IN ('started','uncertain')",[op.id])).rows.length)throw new ApiError(409,'必须先核对原复测外部结果')
   if(!['failed','dead_letter','canceled'].includes(op.status))return{status:202,body:projectOperation(op)}
  }
  const source=await regressionDetail(c,ws,String(task.source_run_id)),ids=task.sample_ids as string[]
  const samples=(source.records as Row[]).filter(r=>ids.includes(String(r.id))||ids.includes(String(r.subjectId))).map(r=>({input:r.artifactText,sampleId:r.subjectId??r.id}))
  if(!samples.length)throw new ApiError(409,'来源产出物不可用')
  const op=await enqueueRegression(c,ws,{rubricId:source.rubricId,samples},user,`retest:${id}:${key!()}`)
  await c.query('UPDATE remediation_tasks SET retest_run_id=$1,updated_by=$2,updated_at=now() WHERE workspace_id=$3 AND id=$4',[op.id,user,ws,id])
  await activity(c,ws,id,user,name,'retest_requested','按当前有效量规重新评估原产出物',[])
  return{status:202,body:projectOperation(op)}
 }
 return{body:await detail(c,ws,id)}
}
function date(v:unknown):Date|null {if(v==null)return null;const d=new Date(String(v));if(!Number.isFinite(+d))throw new ApiError(422,'日期无效');return d}
async function activity(c:SqlClient,ws:string,id:string,user:string,name:string,kind:string,body:string,refs:string[]) {await c.query('INSERT INTO remediation_task_activities(id,workspace_id,task_id,kind,body,attachment_refs,actor_user_id,actor_display_name,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())',[randomUUID(),ws,id,kind,body,JSON.stringify(refs),user,name])}
