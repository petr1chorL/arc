import {ApiError} from '../identity-workspace/handler.ts'
import {createTransactionBackend,workspaceContext,requireCapability,recordAudit,type SqlPool} from '../identity-workspace/postgres.ts'
import {enqueueOperation,projectOperation} from '../runtime/ledger.ts'
import {controlOperation} from '../runtime/controls.ts'
import type {Operation} from '../runtime/types.ts'
import {humanDetail,mutateHuman,taskRow} from './human.ts'
import {enqueueEvaluation,enqueueRegression,regressionDetail} from './evaluation.ts'
import {remediation} from './remediation.ts'
import {readClosure} from './queries.ts'
import {object,project,text} from './policy.ts'
import type {ClosureInput} from './handler.ts'
import {sampleSets} from './samples.ts'

/** Every route uses shared session/CSRF/workspace/role and transaction boundaries. */
export function createPostgresRuntimeClosureBackend(pool:SqlPool,options:{costConfigured?:boolean}={}) {
 return createTransactionBackend<ClosureInput>(pool,async(c,input)=> {
  const {operation,write,params}=input.route,context=await workspaceContext(c,input,write),ws=context.workspace.id,id=params.id??'',user=context.user.id
  const capability=operation.startsWith('human.mutate') ? operation.endsWith('retry-resume')?'run.execute':'asset.read' : operation.startsWith('evaluation')||operation.startsWith('regression')||operation.startsWith('remediation')||operation.startsWith('samples') ? write?'evaluation.run':'asset.read':'run.read'
  const audit={action:`runtime.${operation}`,targetType:'runtime_closure',targetId:id||ws}
  await requireCapability(c,context,input,capability,audit)
  if(operation==='reviews.blocked')throw new ApiError(409,'原生审核必须通过 HumanTask 决定链，历史 Review 只读')
  const body=object(input.body)?input.body:{},key=()=>text(input.request.headers.get('Idempotency-Key')??body.idempotencyKey,160)
  let result
  if(operation.startsWith('samples.'))result=await sampleSets(c,ws,id,user,operation,body)
  else if(operation==='human.detail')result={body:await humanDetail(c,ws,id)}
  else if(operation==='human.mutate.retry-resume') {
   await taskRow(c,ws,id,true)
   const resume=(await c.query('SELECT * FROM resume_requests WHERE workspace_id=$1 AND human_task_id=$2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE',[ws,id])).rows[0]
   if(!resume)throw new ApiError(409,'没有可恢复的审核决定')
   let op=(await c.query<Operation>('SELECT * FROM runtime_operations WHERE workspace_id=$1 AND kind=\'human.resume\' AND target_id=$2',[ws,resume.id])).rows[0]
   if(!op)throw new ApiError(409,'历史恢复请求需迁移治理')
   if(['failed','dead_letter'].includes(op.status))op=await controlOperation(c,ws,op.id,'requeue',{reason:body.reason??'用户请求恢复已确认失败的人工审核运行'},user)
   if(op.status==='needs_reconciliation')throw new ApiError(409,'外部结果待核对，不能直接恢复')
   result={status:202,body:projectOperation(op)}
  } else if(operation.startsWith('human.mutate.'))result=await mutateHuman(c,ws,id,user,operation.split('.').at(-1)!,body,{enqueue:enqueueOperation})
  else if(operation==='evaluation.create'){const op=await enqueueEvaluation(c,ws,id,body,user,key());result={status:202,body:projectOperation(op)}}
  else if(operation==='regression.create'){const op=await enqueueRegression(c,ws,body,user,key());result={status:202,body:{...projectOperation(op),regressionRunId:op.id}}}
  else if(operation==='regression.detail')result={body:await regressionDetail(c,ws,id)}
  else if(operation.startsWith('remediation.'))result=await remediation(c,ws,id,user,context.user.display_name,operation,body,write?()=>key():undefined)
  else result={body:await readClosure(c,ws,id,operation,new URL(input.request.url).searchParams,options)}
  if(write)await recordAudit(c,context,input,{...audit,workspaceId:ws,outcome:'success'})
  return result
 })
}
export {project}
