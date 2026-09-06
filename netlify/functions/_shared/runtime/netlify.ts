import {asyncWorkloadFn,type CustomAsyncWorkloadEvent} from '@netlify/async-workloads'
import type {SqlPool} from '../identity-workspace/postgres.ts'
import {processRuntimeOperation,type RuntimeDependencies} from './service.ts'
import {dispatchOperationEvents} from './worker.ts'
import {dispatchDueSchedules} from '../runtime-delivery/schedules.ts'
import {enqueueOperation,runtimeWithTransaction} from './ledger.ts'
import {submitWorkflow} from './workflow.ts'
import {refreshHumanSla} from '../runtime-closure/sla.ts'

export type RuntimeEvent=CustomAsyncWorkloadEvent&{eventName:'arc-one:runtime';eventData:{operationId:string}}
export type RuntimeSender=(id:string)=>Promise<{sendStatus:string;eventId?:string}>

/** The SDK wrapper supplies event authentication; PG supplies business identity and recovery. */
export function createRuntimeWorkload(pool:SqlPool,deps:RuntimeDependencies,send:RuntimeSender) {
  return asyncWorkloadFn<RuntimeEvent>(async event=>{
    const data=event.eventData
    if(!data||typeof data.operationId!=='string'||!/^[a-f0-9-]{36}$/i.test(data.operationId)||Object.keys(data).length!==1)throw Error('无效任务引用')
    await processRuntimeOperation(pool,data.operationId,deps)
    await dispatchOperationEvents(pool,send,20)
  })
}

/** Bounded scheduled work creates durable intents; it never executes a model or whole workflow. */
export async function tickRuntime(pool:SqlPool,send:RuntimeSender,now=new Date()) {
  const schedules=await dispatchDueSchedules(pool,submitWorkflow,now,20)
  const sla=await runtimeWithTransaction(pool,async client=>{
    const spaces=(await client.query(`SELECT DISTINCT h.workspace_id FROM human_tasks h JOIN workspaces w ON w.id=h.workspace_id
      AND w.status='active' WHERE h.status IN ('待认领','审核中') AND
      ((h.due_reminder_sent_at IS NULL AND h.due_at<=now()+interval '30 minutes') OR
       (h.overdue_recorded_at IS NULL AND h.due_at<=now()) OR (h.escalated_at IS NULL AND h.escalation_at<=now())) LIMIT 20`)).rows
    let changed=0
    for(const space of spaces)changed+=(await refreshHumanSla(client,String(space.workspace_id),20)).changed
    return changed
  })
  const notices=await runtimeWithTransaction(pool,async client=>{
    const rows=(await client.query(`SELECT DISTINCT n.workspace_id FROM notification_outbox n
      JOIN workspaces w ON w.id=n.workspace_id AND w.status='active' WHERE n.status='pending' LIMIT 20`)).rows
    for(const row of rows)await enqueueOperation(client,{workspaceId:String(row.workspace_id),kind:'notification.dispatch',
      idempotencyKey:`notification-tick:${Math.floor(now.getTime()/60000)}`,input:{limit:20}})
    return rows.length
  })
  return{schedules:schedules.length,slaMilestones:sla,notificationWorkspaces:notices,...await dispatchOperationEvents(pool,send,20)}
}
