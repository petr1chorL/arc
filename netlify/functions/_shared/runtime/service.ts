import type { SqlPool,SqlClient } from '../identity-workspace/postgres.ts'
import { ApiError } from '../identity-workspace/handler.ts'
import { createWorkflowExecutor, createAgentExecutor, readRun, submitWorkflow, type WorkflowDependencies } from './workflow.ts'
import { executeOperation } from './worker.ts'
import { appendOperationEvent } from './ledger.ts'
import { controlOperation } from './controls.ts'
import type { Operation, RuntimeContext } from './types.ts'
import { pauseForReview } from '../runtime-closure/human.ts'
import { createClosureExecutor, createWorkflowEvaluator, createGatewayJudgeTransport, type JudgeTransport } from '../runtime-closure/evaluation.ts'
import { dispatchNotifications, type NotificationAdapter } from '../runtime-delivery/notifications.ts'
import { executeScheduleTrigger } from '../runtime-delivery/schedules.ts'
import { executeToolTest, synchronizeToolTest } from './tool-test.ts'

export type RuntimeDependencies = WorkflowDependencies & { judge?: JudgeTransport; notificationAdapters?: Record<string, NotificationAdapter> }

/** Durable initialization lets a resumed workflow use multiple invocations without reapplying a decision. */
async function initializeResume(op: Operation, ctx: RuntimeContext) {
  return ctx.transaction(async client => {
    const parent=(await client.query("SELECT status FROM runtime_operations WHERE workspace_id=$1 AND target_id=$2 AND kind='workflow.run' FOR SHARE",[op.workspace_id,op.input.runId])).rows[0]
    const currentRun=(await client.query('SELECT status FROM workflow_runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[op.workspace_id,op.input.runId])).rows[0]
    if(!currentRun||currentRun.status==='已取消'||parent?.status==='canceled')throw new ApiError(409,'已取消的运行不能通过审核恢复')
    if ((await client.query("SELECT id FROM runtime_operation_events WHERE operation_id=$1 AND event_type='human.resume.initialized'", [op.id])).rows.length) return
    const task = (await client.query('SELECT * FROM human_tasks WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [op.workspace_id,op.input.humanTaskId])).rows[0]
    const resume = (await client.query('SELECT * FROM resume_requests WHERE workspace_id=$1 AND id=$2 AND human_task_id=$3 FOR UPDATE',[op.workspace_id,op.input.resumeRequestId,op.input.humanTaskId])).rows[0]
    if (!task || !resume || task.workflow_run_id !== op.input.runId || resume.decision_id !== op.input.decisionId) throw Error('恢复请求关联无效')
    const artifact=(await client.query(`SELECT v.content FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id AND a.workspace_id=v.workspace_id
      WHERE v.workspace_id=$1 AND v.id=$2 AND a.run_id=$3`,[op.workspace_id,op.input.artifactVersionId,op.input.runId])).rows[0]
    if(!artifact)throw Error('恢复产出物不存在')
    if(op.input.action==='reject') {
      await client.query("UPDATE workflow_runs SET status='已终止',completed_at=now() WHERE workspace_id=$1 AND id=$2",[op.workspace_id,op.input.runId])
      await client.query("UPDATE node_runs SET status='已终止',completed_at=now() WHERE workspace_id=$1 AND id=$2",[op.workspace_id,task.node_run_id])
    } else if(op.input.action==='approve') {
      await client.query("UPDATE runtime_node_checkpoints SET status='succeeded',output_text=$4 WHERE workspace_id=$1 AND run_id=$2 AND node_id=$3",[op.workspace_id,op.input.runId,task.human_node_id,artifact.content])
      await client.query("UPDATE node_runs SET status='已完成',output_text=$3,completed_at=now() WHERE workspace_id=$1 AND id=$2",[op.workspace_id,task.node_run_id,artifact.content])
    } else if(op.input.action==='return_for_rerun') {
      const nodes=(await client.query('SELECT node_id,node_run_id FROM runtime_node_checkpoints WHERE workspace_id=$1 AND run_id=$2',[op.workspace_id,op.input.runId])).rows
      const run=(await client.query('SELECT workflow_id,workflow_version FROM workflow_runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[op.workspace_id,op.input.runId])).rows[0]
      const version=(await client.query('SELECT snapshot FROM workflow_versions WHERE workspace_id=$1 AND workflow_id=$2 AND version=$3',[op.workspace_id,run.workflow_id,run.workflow_version])).rows[0]
      const edges=(version.snapshot as {edges:{source:string;target:string}[]}).edges
      const reset=new Set([String(task.source_node_id)])
      for(let i=0;i<nodes.length;i++)for(const edge of edges)if(reset.has(edge.source))reset.add(edge.target)
      await client.query('DELETE FROM runtime_node_checkpoints WHERE workspace_id=$1 AND run_id=$2 AND node_id=ANY($3::text[])',[op.workspace_id,op.input.runId,[...reset]])
      // Immutable previous node attempts and artifacts remain; the explicit decision authorizes new attempts.
    } else throw Error('恢复动作无效')
    await client.query("UPDATE resume_requests SET status='running',error='' WHERE workspace_id=$1 AND id=$2",[op.workspace_id,resume.id])
    await appendOperationEvent(client,op,'human.resume.initialized',{runId:op.input.runId,decisionId:op.input.decisionId,action:op.input.action})
  })
}

/** Shared consumer entry used by AWL and isolated tests, never by synchronous HTTP requests. */
export async function processRuntimeOperation(pool: SqlPool, id: string, deps: RuntimeDependencies) {
  const judge = deps.judge ?? createGatewayJudgeTransport(pool, deps.complete)
  const evaluate = createWorkflowEvaluator(judge)
  const workflow = createWorkflowExecutor({...deps,pauseForReview:deps.pauseForReview??pauseForReview,
    evaluateNode:deps.evaluateNode??((op,ctx,args)=>evaluate(op,ctx,{...args,rubricRef:args.rubricRef as Record<string,unknown>}))})
  const closure = createClosureExecutor({judge})
  const result = await executeOperation(pool,id,async(op,ctx)=>{
    if(op.kind==='human.resume') {
      await initializeResume(op,ctx)
      if(op.input.action==='reject')return ctx.transaction(client=>readRun(client,op.workspace_id,String(op.input.runId)))
      return workflow(op,ctx)
    }
    if(op.kind==='workflow.run'||op.kind==='workflow.resume')return workflow(op,ctx)
    if(op.kind==='agent.run')return createAgentExecutor(deps)(op,ctx)
    if(op.kind==='tool.test')return executeToolTest(op,ctx,deps.toolOptions)
    if(op.kind==='evaluation.run'||op.kind==='evaluation.regression')return closure(op,ctx)
    if(op.kind==='notification.dispatch')return dispatchNotifications(op,ctx,deps.notificationAdapters)
    if(op.kind==='schedule.trigger')return executeScheduleTrigger(op,ctx,submitWorkflow)
    if(op.kind==='workflow.batch')return ctx.transaction(async client=>{
      const createdRuns=[],failures=[]
      for(const runId of op.input.runIds as string[]) {
        await client.query('SAVEPOINT runtime_batch_item')
        try {
          const run=await readRun(client,op.workspace_id,runId)
          if(op.input.action==='batch-rerun')createdRuns.push((await submitWorkflow(client,{workspaceId:op.workspace_id,workflowId:String(run.workflowId),version:String(run.workflowVersion),inputText:String(run.input),actorId:op.actor_id!,idempotencyKey:`batch:${op.id}:${runId}`})).run)
          else {
            const prior=(await client.query<Operation>("SELECT * FROM runtime_operations WHERE workspace_id=$1 AND (target_id=$2 OR input->>'runId'=$2) AND kind IN ('workflow.run','human.resume') ORDER BY created_at DESC LIMIT 1",[op.workspace_id,runId])).rows[0]
            if(!prior)throw new ApiError(409,'无原生检查点')
            await controlOperation(client,op.workspace_id,prior.id,'requeue',{reason:'批量恢复失败检查点'},op.actor_id!)
            createdRuns.push(await readRun(client,op.workspace_id,runId))
          }
          await client.query('RELEASE SAVEPOINT runtime_batch_item')
        } catch(error) {
          await client.query('ROLLBACK TO SAVEPOINT runtime_batch_item')
          if(!(error instanceof ApiError))throw error
          failures.push({sourceRunId:runId,reason:error.message})
        }
      }
      return op.input.action==='batch-rerun'?{createdRuns,failures}:{resumedRuns:createdRuns,failures}
    })
    throw new ApiError(422,'未知任务类型')
  },synchronizeRun)
  return result
}

async function synchronizeRun(client:SqlClient,op:Operation) {
  if(op.kind==='tool.test')return synchronizeToolTest(client,op)
  const runId=['workflow.run','agent.run'].includes(op.kind)?op.target_id:op.kind==='human.resume'||op.kind==='workflow.resume'?op.input.runId:null
  if(!runId)return
    const current=(await client.query<Operation>('SELECT * FROM runtime_operations WHERE id=$1 AND generation=$2 FOR UPDATE',[op.id,op.generation])).rows[0]
    if(!current||current.status!==op.status)return
    const run=(await client.query('SELECT status FROM workflow_runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[op.workspace_id,runId])).rows[0]
    if(run?.status==='已取消')return
    const failed=['failed','dead_letter','needs_reconciliation'].includes(op.status)
    if(failed) {
      await client.query("UPDATE workflow_runs SET status=$3::varchar,error=$4,completed_at=CASE WHEN $3='失败' THEN now() ELSE NULL END WHERE workspace_id=$1 AND id=$2",[op.workspace_id,runId,op.status==='needs_reconciliation'?'结果待核对':'失败',op.error])
      await client.query("UPDATE node_runs SET status=$3,error=$4 WHERE workspace_id=$1 AND run_id=$2 AND status='运行中'",[op.workspace_id,runId,op.status==='needs_reconciliation'?'结果待核对':'失败',op.error])
    }
    if(op.kind==='human.resume') {
      await client.query('UPDATE resume_requests SET status=$3,error=$4,completed_at=$5 WHERE workspace_id=$1 AND id=$2',[op.workspace_id,op.input.resumeRequestId,op.status==='succeeded'?'succeeded':failed?'failed':'running',op.error,op.status==='succeeded'||failed?new Date():null])
      if(failed)await client.query("UPDATE human_tasks SET status='恢复失败',updated_at=now() WHERE workspace_id=$1 AND id=$2",[op.workspace_id,op.input.humanTaskId])
    }
    if(op.status==='succeeded')await client.query(`UPDATE runtime_operations SET status='succeeded',result=$3,updated_at=now()
      WHERE workspace_id=$1 AND target_id=$2 AND kind='workflow.run' AND status='waiting_review'`,[op.workspace_id,runId,JSON.stringify(op.result)])
}
