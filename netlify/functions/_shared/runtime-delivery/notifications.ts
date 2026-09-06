import type { Operation, RuntimeContext } from '../runtime/types.ts'
import { ContinueOperation, NotSentError } from '../runtime/types.ts'
import { ApiError } from '../identity-workspace/handler.ts'
import { object, parseChannel } from './policy.ts'

type Row = Record<string,unknown>
export type DeliveryResult = {status:'sent'|'failed';providerMessageId?:string;errorCode?:string}
export type NotificationAdapter = (input:{id:string;eventKey:string;recipientType:string;recipientId:string;payload:Record<string,unknown>;channel:ReturnType<typeof parseChannel>;signal:AbortSignal}) => Promise<DeliveryResult>

/** Batch ownership is persisted before any send; another operation cannot replay these rows. */
export async function dispatchNotifications(operation:Operation,context:RuntimeContext,adapters:Readonly<Record<string,NotificationAdapter>> = {}) {
  const limit = Number(operation.input.limit ?? 20)
  if (!Number.isInteger(limit) || limit<1 || limit>100) throw new ApiError(422,'limit 无效')
  const rows = await context.transaction(async client=>{
    const owned = (await client.query(`SELECT * FROM notification_outbox WHERE workspace_id=$1 AND payload->'dispatch'->>'operationId'=$2 ORDER BY created_at,id LIMIT $3 FOR UPDATE`,[operation.workspace_id,operation.id,limit])).rows
    const candidates = owned.length ? owned : (await client.query(`SELECT * FROM notification_outbox WHERE workspace_id=$1 AND status='pending' ORDER BY created_at,id LIMIT $2 FOR UPDATE SKIP LOCKED`,[operation.workspace_id,limit])).rows
    for (const row of candidates) {
      if (row.status !== 'pending') continue
      const payload = object(row.payload)
      payload.dispatch = {operationId:operation.id,status:'dispatching'}
      row.payload=payload; row.status='dispatching'
      await client.query("UPDATE notification_outbox SET status='dispatching',payload=$1 WHERE workspace_id=$2 AND id=$3",[JSON.stringify(payload),operation.workspace_id,row.id])
    }
    return candidates
  })
  const items = []
  let worked=0
  for (const row of rows) {
    if (row.status==='sent' || row.status==='failed') {items.push(item(row)); continue}
    if (++worked>5) throw new ContinueOperation('通知批次继续')
    const payload = object(row.payload), channelType = String(payload.channel ?? (Array.isArray(payload.channels)?payload.channels[0]:undefined) ?? 'in_app')
    const body = {...payload}; delete body.dispatch
    let result:DeliveryResult
    if (channelType==='in_app') {
      // The persisted outbox row is the in-app inbox, not an external delivery assertion.
      result={status:'sent',providerMessageId:`in-app:${row.id}`}
    } else {
      result = await context.effect(`notification:${row.id}`,{eventKey:row.event_key,recipientType:row.recipient_type,recipientId:row.recipient_id,channelType,payload:body},async()=>{
        const channel = await context.transaction(async client=>(await client.query("SELECT * FROM notification_channels WHERE workspace_id=$1 AND channel_type=$2 ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,created_at,id LIMIT 1",[operation.workspace_id,channelType])).rows[0])
        if (!channel || !adapters[channelType]) return {status:'failed' as const,errorCode:'channel_not_configured'}
        if (channel.status!=='active') return {status:'failed' as const,errorCode:'channel_disabled'}
        let config:ReturnType<typeof parseChannel>
        try { config=parseChannel({name:channel.name,channelType:channel.channel_type,config:channel.config,secretRef:channel.secret_ref}) }
        catch { throw new NotSentError('通知渠道配置无效，尚未调用发送器') }
        const controller = new AbortController()
        let timeout:ReturnType<typeof setTimeout> | undefined
        try {
          const sent = await Promise.race([
            adapters[channelType]({id:String(row.id),eventKey:String(row.event_key),recipientType:String(row.recipient_type),recipientId:String(row.recipient_id),payload:body,channel:config,signal:controller.signal}),
            new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('notification_timeout'))},10000)}),
          ])
          if (!sent || !['sent','failed'].includes(sent.status)) throw new Error('notification_result_unconfirmed')
          return {status:sent.status,providerMessageId:String(sent.providerMessageId??'').slice(0,200),errorCode:sent.status==='failed'?'delivery_rejected':''}
        } finally {if(timeout)clearTimeout(timeout)}
      })
    }
    await context.transaction(async client=>{
      const updated = await client.query(`UPDATE notification_outbox SET status=$1,payload=jsonb_set(payload::jsonb,'{dispatch}',$2::jsonb)::json
        WHERE workspace_id=$3 AND id=$4 AND status='dispatching' AND payload->'dispatch'->>'operationId'=$5`,[result.status,JSON.stringify({...result,operationId:operation.id,channel:channelType,deliveryKind:channelType==='in_app'?'persistent_in_app':'external',confirmedAt:new Date().toISOString()}),operation.workspace_id,row.id,operation.id])
      if (updated.rowCount!==1) throw new ApiError(409,'通知归属已经变化')
    })
    items.push({id:row.id,eventKey:row.event_key,channel:channelType,errorCode:'',providerMessageId:'',...result})
  }
  return {processed:items.length,sent:items.filter(x=>x.status==='sent').length,failed:items.filter(x=>x.status==='failed').length,items}
}

function item(row:Row) {
  const dispatch=object(object(row.payload).dispatch)
  return {id:row.id,eventKey:row.event_key,status:row.status,channel:dispatch.channel??'',errorCode:dispatch.errorCode??'',providerMessageId:dispatch.providerMessageId??''}
}
