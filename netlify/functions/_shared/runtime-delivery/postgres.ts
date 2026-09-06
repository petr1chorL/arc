import { randomUUID } from 'node:crypto'
import { ApiError } from '../identity-workspace/handler.ts'
import { createTransactionBackend, workspaceContext, requireCapability, recordAudit, type SqlPool } from '../identity-workspace/postgres.ts'
import { enqueueOperation, projectOperation } from '../runtime/ledger.ts'
import type { RuntimeDeliveryInput } from './handler.ts'
import { object, parseChannel, text, limitParam } from './policy.ts'
import { scheduleRequest } from './schedules.ts'

/** Short authenticated transactions only; dispatch requests durably enqueue work. */
export function createPostgresRuntimeDeliveryBackend(pool: SqlPool) {
  return createTransactionBackend<RuntimeDeliveryInput>(pool, async (client,input) => {
    const {operation,params} = input.route
    const write = !['schedule-list','schedule-dispatches','channel-list','outbox-list'].includes(operation)
    const context = await workspaceContext(client,input,write), workspaceId = context.workspace.id
    const audit = {action:operation.replaceAll('-','.'),targetType:operation.startsWith('schedule')?'workflow_schedule':'notification_outbox',targetId:params.id ?? workspaceId}
    await requireCapability(client,context,input,operation.startsWith('schedule') && !write ? 'run.read' : 'workspace.manage',audit)
    let result
    if (operation.startsWith('schedule')) result = await scheduleRequest(client,input,workspaceId,context.user.id)
    else if (operation === 'channel-list') {
      result = {body:(await client.query('SELECT * FROM notification_channels WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200',[workspaceId])).rows.map(projectChannel)}
    } else if (operation === 'channel-create') {
      const fields = parseChannel(input.body)
      if ((await client.query('SELECT id FROM notification_channels WHERE workspace_id=$1 AND name=$2',[workspaceId,fields.name])).rows.length) throw new ApiError(409,'通知渠道名称已存在')
      const row = (await client.query(`INSERT INTO notification_channels(id,workspace_id,name,channel_type,status,config,secret_ref,created_by,created_at,updated_at)
        VALUES($1,$2,$3,$4,'active',$5,$6,$7,now(),now()) RETURNING *`,[randomUUID(),workspaceId,fields.name,fields.channelType,JSON.stringify(fields.config),fields.secretRef,context.user.id])).rows[0]
      audit.targetId = String(row.id); result = {body:projectChannel(row)}
    } else if (operation === 'channel-disable' || operation === 'channel-enable') {
      const row = (await client.query("UPDATE notification_channels SET status=$1,updated_at=now() WHERE workspace_id=$2 AND id=$3 RETURNING *",[operation==='channel-enable'?'active':'disabled',workspaceId,params.id])).rows[0]
      if (!row) throw new ApiError(404,'通知渠道不存在')
      result = {body:projectChannel(row)}
    } else if (operation === 'outbox-dispatch') {
      const limit = limitParam(new URL(input.request.url),20,100)
      const operationRow = await enqueueOperation(client,{workspaceId,kind:'notification.dispatch',idempotencyKey:text(input.request.headers.get('Idempotency-Key'),'Idempotency-Key',200),input:{limit},actorId:context.user.id})
      result = {status:202,body:projectOperation(operationRow)}
    } else if (operation === 'outbox-list') {
      const url = new URL(input.request.url), limit = limitParam(url,50,200)
      const rows = (await client.query(`SELECT n.*,o.status operation_status FROM notification_outbox n
        LEFT JOIN runtime_operations o ON o.id=n.payload->'dispatch'->>'operationId' AND o.workspace_id=n.workspace_id
        WHERE n.workspace_id=$1
        AND ($2::text IS NULL OR CASE WHEN n.status='dispatching' AND o.status='needs_reconciliation' THEN o.status WHEN n.status='dispatching' AND o.status IN ('canceled','failed','dead_letter') THEN 'canceled' ELSE n.status END=$2)
        AND ($3::text IS NULL OR COALESCE(n.payload->>'channel',n.payload->'channels'->>0,'in_app')=$3)
        AND ($4::text IS NULL OR n.payload->'dispatch'->>'errorCode'=$4)
        ORDER BY n.created_at DESC,n.id DESC LIMIT $5`,[workspaceId,url.searchParams.get('status'),url.searchParams.get('channel'),url.searchParams.get('errorCode'),limit])).rows
      result = {body:rows.map(projectNotification)}
    } else if (operation === 'outbox-requeue') {
      const body = object(input.body ?? {}), reason = text(body.reason ?? '手动重新入队','reason',1000,true)
      if (Object.keys(body).some(key=>key!=='reason')) throw new ApiError(422,'未知重投字段')
      const row = (await client.query('SELECT * FROM notification_outbox WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[workspaceId,params.id])).rows[0]
      if (!row) throw new ApiError(404,'通知不存在')
      if (row.status !== 'failed') throw new ApiError(409,'只能重投已确认失败的通知；结果不确定请核对原 Operation')
      const payload = object(row.payload), history = Array.isArray(payload.deliveryHistory) ? payload.deliveryHistory : []
      payload.deliveryHistory = [...history, payload.dispatch].slice(-50)
      delete payload.dispatch
      row.status = 'pending'; row.payload = payload
      await client.query("UPDATE notification_outbox SET status='pending',payload=$1 WHERE id=$2 AND workspace_id=$3",[JSON.stringify(payload),row.id,workspaceId])
      result = {body:projectNotification(row)}
      await recordAudit(client,context,input,{...audit,workspaceId,outcome:'success',metadata:{reason}})
      return result
    } else throw new ApiError(404,'Not Found')
    if (write) await recordAudit(client,context,input,{...audit,workspaceId,outcome:'success'})
    return result
  })
}

function projectChannel(row: Record<string,unknown>) {
  // Validate historical records too: registration never grants permission to expose inline secrets.
  const fields = parseChannel({name:row.name,channelType:row.channel_type,config:row.config,secretRef:row.secret_ref})
  return {id:row.id,workspaceId:row.workspace_id,...fields,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at}
}

export function projectNotification(row: Record<string,unknown>) {
  const effective = row.status==='dispatching' && row.operation_status==='needs_reconciliation'?'needs_reconciliation'
    : row.status==='dispatching' && ['canceled','failed','dead_letter'].includes(String(row.operation_status))?'canceled':row.status
  return {id:row.id,eventType:row.event_type,recipientType:row.recipient_type,recipientId:row.recipient_id,payload:row.payload,
    status:effective,createdAt:row.created_at}
}
