import { randomUUID } from 'node:crypto'
import { ApiError } from '../identity-workspace/handler.ts'
import type { SqlClient, SqlPool } from '../identity-workspace/postgres.ts'
import { enqueueOperation, projectOperation, runtimeWithTransaction } from '../runtime/ledger.ts'
import type { Operation, RuntimeContext } from '../runtime/types.ts'
import type { RuntimeDeliveryInput } from './handler.ts'
import { parseSchedule, nextScheduleTime, text } from './policy.ts'

export type EnqueueRun = (client:SqlClient,input:{workspaceId:string;workflowId:string;version:string;inputText:string;idempotencyKey:string;actorId:string}) => Promise<{run:{id:string};operation?:unknown}>
type Row = Record<string,unknown>
const joinedSchedules = `SELECT s.*,w.name workflow_name,r.status last_run_status FROM workflow_schedules s
  LEFT JOIN workflows w ON w.id=s.workflow_id AND w.workspace_id=s.workspace_id
  LEFT JOIN workflow_runs r ON r.id=s.last_run_id AND r.workspace_id=s.workspace_id`

export async function scheduleRequest(client:SqlClient,input:RuntimeDeliveryInput,workspaceId:string,actorId:string) {
  const {operation,params} = input.route
  if (operation === 'schedule-list') return {body:(await client.query(`${joinedSchedules} WHERE s.workspace_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 200`,[workspaceId])).rows.map(projectSchedule)}
  if (operation === 'schedule-create') {
    const values = parseSchedule(input.body), now = new Date()
    const version = await versionFor(client,workspaceId,values)
    const next = nextScheduleTime(String(values.cronExpression),String(values.timezone),now)
    if ((await client.query('SELECT id FROM workflow_schedules WHERE workspace_id=$1 AND name=$2',[workspaceId,values.name])).rows.length) throw new ApiError(409,'schedule name already exists')
    const row = (await client.query(`INSERT INTO workflow_schedules(id,workspace_id,name,workflow_id,workflow_version_id,workflow_version,cron_expression,timezone,input_text,status,next_run_at,created_by,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,[randomUUID(),workspaceId,values.name,values.workflowId,version.id,values.workflowVersion,values.cronExpression,values.timezone,values.input,values.status,values.status==='active'?next:null,actorId,now])).rows[0]
    return {status:201,body:projectSchedule({...row,workflow_name:version.name,last_run_status:null})}
  }
  const row = (await client.query(`${joinedSchedules} WHERE s.workspace_id=$1 AND s.id=$2 FOR UPDATE OF s`,[workspaceId,params.id])).rows[0]
  if (!row) throw new ApiError(404,'调度不存在')
  if (operation === 'schedule-dispatches') return {body:(await client.query(`SELECT d.*,r.status run_status FROM schedule_dispatches d LEFT JOIN workflow_runs r ON r.id=d.run_id AND r.workspace_id=d.workspace_id WHERE d.workspace_id=$1 AND d.schedule_id=$2 ORDER BY d.created_at DESC,d.id DESC LIMIT 50`,[workspaceId,row.id])).rows.map(projectDispatch)}
  if (operation === 'schedule-trigger') {
    const key=text(input.request.headers.get('Idempotency-Key'),'Idempotency-Key',200)
    const previous=(await client.query<Operation>("SELECT * FROM runtime_operations WHERE workspace_id=$1 AND kind='schedule.trigger' AND idempotency_key=$2",[workspaceId,key])).rows[0]
    if(previous) {
      if(previous.target_id!==row.id || previous.actor_id!==actorId)throw new ApiError(409,'幂等键已用于不同请求')
      return {status:202,body:projectOperation(previous)}
    }
    const op = await enqueueOperation(client,{workspaceId,kind:'schedule.trigger',idempotencyKey:key,
      input:{scheduleId:row.id,workflowId:row.workflow_id,workflowVersion:row.workflow_version,workflowVersionId:row.workflow_version_id,inputText:row.input_text},targetId:String(row.id),actorId})
    return {status:202,body:projectOperation(op)}
  }
  if (operation === 'schedule-update') {
    const changes = parseSchedule(input.body,true)
    const values = {...projectSchedule(row),...changes}
    const version = await versionFor(client,workspaceId,values)
    if ((await client.query('SELECT id FROM workflow_schedules WHERE workspace_id=$1 AND name=$2 AND id<>$3',[workspaceId,values.name,row.id])).rows.length) throw new ApiError(409,'schedule name already exists')
    const next = nextScheduleTime(String(values.cronExpression),String(values.timezone),new Date())
    await client.query(`UPDATE workflow_schedules SET name=$1,workflow_id=$2,workflow_version_id=$3,workflow_version=$4,cron_expression=$5,timezone=$6,input_text=$7,next_run_at=$8,updated_at=now() WHERE workspace_id=$9 AND id=$10`,[values.name,values.workflowId,version.id,values.workflowVersion,values.cronExpression,values.timezone,values.input,row.status==='active'?next:null,workspaceId,row.id])
  } else {
    const active = operation==='schedule-resume'
    await client.query('UPDATE workflow_schedules SET status=$1,next_run_at=$2,updated_at=now() WHERE workspace_id=$3 AND id=$4',[active?'active':'paused',active?nextScheduleTime(String(row.cron_expression),String(row.timezone),new Date()):null,workspaceId,row.id])
  }
  return {body:projectSchedule((await client.query(`${joinedSchedules} WHERE s.workspace_id=$1 AND s.id=$2`,[workspaceId,row.id])).rows[0])}
}

async function versionFor(client:SqlClient,workspaceId:string,values:Row) {
  const row = (await client.query(`SELECT v.id,w.name FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id AND w.workspace_id=v.workspace_id WHERE v.workspace_id=$1 AND v.workflow_id=$2 AND v.version=$3 AND w.status<>'已删除'`,[workspaceId,values.workflowId,values.workflowVersion])).rows[0]
  if (!row) throw new ApiError(422,'已发布的工作流版本不存在')
  return row
}

/** One short transaction creates dispatch, run, operation and event outbox together. */
async function dispatchSlot(client:SqlClient,row:Row,scheduledFor:Date,enqueueRun:EnqueueRun,actorId:string) {
  const previous = (await client.query('SELECT * FROM schedule_dispatches WHERE schedule_id=$1 AND scheduled_for=$2 AND workspace_id=$3',[row.id,scheduledFor,row.workspace_id])).rows[0]
  if (previous) return previous
  const dispatch = (await client.query(`INSERT INTO schedule_dispatches(id,workspace_id,schedule_id,scheduled_for,status,reason,created_at) VALUES($1,$2,$3,$4,'pending','',now()) RETURNING *`,[randomUUID(),row.workspace_id,row.id,scheduledFor])).rows[0]
  const overlapping = row.last_run_id && (await client.query('SELECT id FROM workflow_runs WHERE id=$1 AND workspace_id=$2 AND completed_at IS NULL',[row.last_run_id,row.workspace_id])).rows.length
  let runId = null, state = overlapping?'skipped':'queued', reason = overlapping?'previous_run_incomplete':''
  if (!overlapping) {
    // Roll back only the failed submission; retaining its slot is explicit and observable.
    await client.query('SAVEPOINT schedule_submission')
    try {
      const result = await enqueueRun(client,{workspaceId:String(row.workspace_id),workflowId:String(row.workflow_id),version:String(row.workflow_version),inputText:String(row.input_text),idempotencyKey:`schedule:${row.id}:${scheduledFor.toISOString()}`,actorId})
      runId = result.run.id
      await client.query('RELEASE SAVEPOINT schedule_submission')
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT schedule_submission')
      if (!(error instanceof ApiError) || error.status >= 500) throw error
      state='failed'; reason='workflow_submission_rejected'
    }
  }
  await client.query('UPDATE schedule_dispatches SET status=$1,run_id=$2,reason=$3 WHERE id=$4',[state,runId,reason,dispatch.id])
  await client.query('UPDATE workflow_schedules SET last_scheduled_for=$1,last_run_id=COALESCE($2,last_run_id),updated_at=now() WHERE workspace_id=$3 AND id=$4',[scheduledFor,runId,row.workspace_id,row.id])
  return {...dispatch,status:state,run_id:runId,reason}
}

/** Due work skips missed slots; concurrent scanners serialize with SKIP LOCKED. */
export async function dispatchDueSchedules(pool:SqlPool,enqueueRun:EnqueueRun,now = new Date(),limit = 20) {
  if (!Number.isInteger(limit) || limit<1 || limit>100) throw new ApiError(422,'limit 无效')
  return runtimeWithTransaction(pool,async client=>{
    const rows = (await client.query("SELECT s.* FROM workflow_schedules s JOIN workspaces w ON w.id=s.workspace_id AND w.status='active' WHERE s.status='active' AND s.next_run_at<=$1 ORDER BY s.next_run_at,s.id LIMIT $2 FOR UPDATE OF s SKIP LOCKED",[now,limit])).rows
    const dispatched = []
    for (const row of rows) {
      const next = nextScheduleTime(String(row.cron_expression),String(row.timezone),now)
      dispatched.push(await dispatchSlot(client,row,new Date(String(row.next_run_at)),enqueueRun,String(row.created_by)))
      await client.query('UPDATE workflow_schedules SET next_run_at=$1 WHERE id=$2 AND workspace_id=$3',[next,row.id,row.workspace_id])
    }
    return dispatched.map(projectDispatch)
  })
}

export async function executeScheduleTrigger(operation:Operation,context:RuntimeContext,enqueueRun:EnqueueRun) {
  return context.transaction(async client=>{
    const row = (await client.query('SELECT * FROM workflow_schedules WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[operation.workspace_id,operation.input.scheduleId])).rows[0]
    if (!row) throw new ApiError(404,'调度不存在')
    const fixed={...row,workflow_id:operation.input.workflowId,workflow_version:operation.input.workflowVersion,workflow_version_id:operation.input.workflowVersionId,input_text:operation.input.inputText}
    return projectDispatch(await dispatchSlot(client,fixed,new Date(operation.created_at),enqueueRun,operation.actor_id ?? String(row.created_by)))
  })
}

function projectSchedule(row:Row) {
  return {id:row.id,name:row.name,workflowId:row.workflow_id,workflowName:row.workflow_name,workflowVersionId:row.workflow_version_id,workflowVersion:row.workflow_version,cronExpression:row.cron_expression,timezone:row.timezone,input:row.input_text,status:row.status,nextRunAt:row.next_run_at,lastScheduledFor:row.last_scheduled_for,lastRunId:row.last_run_id,lastRunStatus:row.last_run_status,createdBy:row.created_by,createdAt:row.created_at,updatedAt:row.updated_at}
}

function projectDispatch(row:Row) {
  return {id:row.id,scheduleId:row.schedule_id,scheduledFor:row.scheduled_for,status:row.status,runId:row.run_id,runStatus:row.run_status??null,reason:row.reason,createdAt:row.created_at}
}
