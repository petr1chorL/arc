import { randomUUID } from 'node:crypto'
import { ApiError } from '../identity-workspace/handler.ts'
import { createTransactionBackend, workspaceContext, requireCapability, recordAudit, type SqlPool } from '../identity-workspace/postgres.ts'
import { object } from '../workflows/policy.ts'
import { controlOperation } from './controls.ts'
import { enqueueOperation, projectOperation } from './ledger.ts'
import { submitWorkflow, submitAgent, readRun } from './workflow.ts'
import type { Operation } from './types.ts'
import type { RuntimeInput } from './handler.ts'

/** HTTP never calls external gateways or runs the worker synchronously. */
export function createPostgresRuntimeBackend(pool: SqlPool) {
  return createTransactionBackend<RuntimeInput>(pool, async (client, input) => {
    const { operation, params } = input.route
    const write = input.request.method !== 'GET'
    const context = await workspaceContext(client, input, write, write), ws = context.workspace.id
    const audit = { action: `runtime.${operation}`, targetType: 'runtime_operation', targetId: params.id ?? ws }
    await requireCapability(client, context, input, params.action === 'reconcile' ? 'workspace.manage' : write ? 'run.execute' : 'run.read', audit)
    const body = input.body == null ? {} : input.body
    if (!object(body)) throw new ApiError(422, '运行请求无效')
    const key = input.request.headers.get('Idempotency-Key') ?? body.idempotencyKey ?? randomUUID()
    if (typeof key !== 'string') throw new ApiError(422, '幂等键无效')
    const url = new URL(input.request.url), rawLimit = url.searchParams.get('limit') ?? '100'
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 200) throw new ApiError(422, 'limit 无效')
    const limit = Number(rawLimit)
    let response
    if (operation === 'operations.list') {
      // Notification configuration and dispatch are workspace-admin-only even through this generic view.
      const rows = (await client.query<Operation>("SELECT * FROM runtime_operations WHERE workspace_id=$1 AND kind NOT LIKE 'notification.%' ORDER BY created_at DESC,id DESC LIMIT $2", [ws,limit])).rows
      return { body: rows.map(projectOperation) }
    }
    if (['operations.get','operations.control','jobs.get','jobs.control'].includes(operation)) {
      const op = (await client.query<Operation>('SELECT * FROM runtime_operations WHERE workspace_id=$1 AND id=$2', [ws, params.id])).rows[0]
      if (!op) throw new ApiError(404, '任务不存在')
      if (op.kind.startsWith('notification.')) await requireCapability(client,context,input,'workspace.manage',audit)
      if (operation === 'operations.get') return { body: projectOperation(op) }
      if (operation === 'jobs.get') return { body: projectJob(op) }
      if (params.action === 'heartbeat') throw new ApiError(409, '执行租约只允许持有当前代次的内部 Worker 更新')
      const updated = await controlOperation(client,ws,op.id,params.action!,body,context.user.id)
      response = { body: operation === 'jobs.control' ? projectJob(updated) : projectOperation(updated) }
    } else if (operation === 'workflow.submit') {
      if (body.version !== undefined && typeof body.version !== 'string') throw new ApiError(422, '工作流版本无效')
      const {operation:op,run} = await submitWorkflow(client,{workspaceId:ws,workflowId:params.workflowId!,version:body.version as string|undefined,
        inputText: body.input as string,idempotencyKey:key,actorId:context.user.id})
      response={status:202,body:{...projectOperation(op),runId:run.id}}
    } else if(operation==='agent.submit') {
      if(body.version!==undefined&&typeof body.version!=='string')throw new ApiError(422,'Agent 版本无效')
      const submitted=await submitAgent(client,{workspaceId:ws,agentId:params.agentId!,version:body.version as string|undefined,inputText:body.input as string,idempotencyKey:key,actorId:context.user.id})
      response={status:202,body:{...projectOperation(submitted.operation),runId:submitted.run.id}}
    } else if (operation === 'runs.list') {
      const rows = (await client.query('SELECT id FROM workflow_runs WHERE workspace_id=$1 ORDER BY started_at DESC,id DESC LIMIT $2',[ws,limit])).rows
      return {body:await Promise.all(rows.map(row=>readRun(client,ws,String(row.id))))}
    } else if (operation === 'runs.get') return {body:await readRun(client,ws,params.id!)}
    else if (operation === 'runs.history') {
      await readRun(client,ws,params.id!)
      const rows=(await client.query(`SELECT e.* FROM runtime_operation_events e JOIN runtime_operations o ON o.id=e.operation_id
        WHERE e.workspace_id=$1 AND (o.target_id=$2 OR o.input->>'runId'=$2) ORDER BY e.created_at DESC,e.id DESC LIMIT $3`,[ws,params.id,limit])).rows
      return {body:rows.map(row=>({id:row.id,action:row.event_type,traceId:`trace-${params.id}`,targetType:'run',targetId:params.id,
        outcome:row.event_type,reason:object(row.details)?row.details.reason??'':'',actorId:row.actor_id,requestId:null,createdAt:row.created_at,metadata:row.details}))}
    } else if (operation === 'jobs.list') {
      return {body:(await client.query<Operation>("SELECT * FROM runtime_operations WHERE workspace_id=$1 AND kind IN ('workflow.run','workflow.resume','human.resume') ORDER BY created_at DESC,id DESC LIMIT $2",[ws,limit])).rows.map(projectJob)}
    } else if (operation === 'runs.control') {
      const run=await readRun(client,ws,params.id!)
      if(params.action==='rerun') {
        if(run.kind!=='workflow')throw new ApiError(409,'仅支持工作流重跑')
        const created=await submitWorkflow(client,{workspaceId:ws,workflowId:String(run.workflowId),version:String(run.workflowVersion),inputText:(body.input??run.input) as string,idempotencyKey:key,actorId:context.user.id})
        response={status:202,body:projectOperation(created.operation)}
      } else {
        const op=(await client.query<Operation>("SELECT * FROM runtime_operations WHERE workspace_id=$1 AND (target_id=$2 OR input->>'runId'=$2) AND kind IN ('workflow.run','human.resume') ORDER BY created_at DESC LIMIT 1",[ws,run.id])).rows[0]
        if(!op)throw new ApiError(409,'历史运行尚未建立原生执行账本')
        response={status:202,body:projectOperation(await controlOperation(client,ws,op.id,'requeue',{reason:'从持久化失败检查点恢复'},context.user.id))}
      }
    } else if(operation==='runs.batch') {
      if(!Array.isArray(body.runIds)||!body.runIds.length||body.runIds.length>50||body.runIds.some(id=>typeof id!=='string'))throw new ApiError(422,'运行批次参数无效')
      for(const id of body.runIds)await readRun(client,ws,id)
      const op=await enqueueOperation(client,{workspaceId:ws,kind:'workflow.batch',idempotencyKey:key,actorId:context.user.id,input:{runIds:body.runIds,action:params.action}})
      response={status:202,body:projectOperation(op)}
    } else throw new ApiError(409,'运行入口尚未接入原生执行器')
    await recordAudit(client,context,input,{...audit,workspaceId:ws,outcome:'success'})
    return response
  })
}

function projectJob(op:Operation) {
  return {id:op.id,workspaceId:op.workspace_id,runId:['human.resume','workflow.resume'].includes(op.kind)?op.input.runId:op.target_id,workflowId:op.input.workflowId??null,
    workflowVersion:op.input.version??null,jobType:op.kind,status:op.status,input:op.input.inputText??'',attempts:op.attempts,
    maxAttempts:op.max_attempts,error:op.error,createdBy:op.actor_id,lockedBy:op.status==='running'?`generation:${op.generation}`:'',
    lockedUntil:op.locked_until,lastHeartbeatAt:null,nextAttemptAt:op.available_at,createdAt:op.created_at,
    startedAt:op.attempts?op.updated_at:null,completedAt:['succeeded','failed','canceled','dead_letter'].includes(op.status)?op.updated_at:null,
    deadLetteredAt:op.status==='dead_letter'?op.updated_at:null,canceledAt:op.status==='canceled'?op.updated_at:null,auditEvents:[]}
}
