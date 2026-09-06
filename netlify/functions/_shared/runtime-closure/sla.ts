import {randomUUID} from 'node:crypto'
import type {SqlClient} from '../identity-workspace/postgres.ts'
/** Bounded cron sweep; due notifications and milestones commit together, never from GET. */
export async function refreshHumanSla(client:SqlClient,workspaceId:string,limit=100) {
 const tasks=(await client.query("SELECT * FROM human_tasks WHERE workspace_id=$1 AND status IN ('待认领','审核中') AND ((due_reminder_sent_at IS NULL AND due_at<=now()+interval '30 minutes') OR (overdue_recorded_at IS NULL AND due_at<=now()) OR (escalated_at IS NULL AND escalation_at<=now())) ORDER BY due_at,id LIMIT $2 FOR UPDATE SKIP LOCKED",[workspaceId,Math.max(1,Math.min(200,limit))])).rows
 let changed=0
 for(const task of tasks) {
  const current=Date.now(),due=new Date(String(task.due_at)).getTime(),escalation=new Date(String(task.escalation_at)).getTime()
  const milestones:[string,string,string][]=[]
  if(!task.due_reminder_sent_at)milestones.push(['due_soon','即将到期','due_reminder_sent_at'])
  if(due<=current&&!task.overdue_recorded_at)milestones.push(['overdue','已逾期','overdue_recorded_at'])
  if(escalation<=current&&!task.escalated_at)milestones.push(['escalated','已升级','escalated_at'])
  for(const[event,status,column]of milestones) {
   const recipient=event==='escalated'&&task.escalation_group_id?task.escalation_group_id:task.assignee_reviewer_id??task.assignee_group_id??(task.participant_snapshot as string[])[0]
   if(!recipient)continue
   const run=(await client.query('SELECT trace_id FROM workflow_runs WHERE workspace_id=$1 AND id=$2',[workspaceId,task.workflow_run_id])).rows[0]
   await client.query("INSERT INTO notification_outbox(id,workspace_id,event_key,human_task_id,event_type,recipient_type,recipient_id,payload,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',now()) ON CONFLICT(event_key) DO NOTHING",[randomUUID(),workspaceId,`human-task:${task.id}:${event}`,task.id,`human_task.${event}`,recipient===task.assignee_reviewer_id?'reviewer':'group',recipient,JSON.stringify({channel:'in_app',runId:task.workflow_run_id,traceId:run?.trace_id??''})])
   await client.query(`UPDATE human_tasks SET ${column}=now(),sla_status=$1,updated_at=now() WHERE workspace_id=$2 AND id=$3`,[status,workspaceId,task.id])
   await client.query('INSERT INTO audit_events(id,workspace_id,human_task_id,event_type,actor_id,reason,before_status,after_status,payload,trace_id,created_at) VALUES($1,$2,$3,$4::varchar,\'runtime\',$4::varchar,$5,$6,\'{}\',$7,now())',[randomUUID(),workspaceId,task.id,`human_task.${event}`,task.sla_status,status,run?.trace_id??''])
   changed++
  }
 }
 return{considered:tasks.length,changed}
}
