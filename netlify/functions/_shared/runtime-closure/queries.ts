import {ApiError} from '../identity-workspace/handler.ts'
import type {SqlClient} from '../identity-workspace/postgres.ts'
import {project,validateArtifact} from './policy.ts'
import type {Row} from './types.ts'
import {regressionDetail} from './evaluation.ts'
const active=['待认领','审核中','恢复失败']
function sla(row:Row){return !active.includes(String(row.status))?String(row.sla_status):new Date(String(row.escalation_at))<new Date()?'已升级':new Date(String(row.due_at))<new Date()?'已逾期':new Date(String(row.due_at)).getTime()-Date.now()<1800000?'即将到期':'正常'}
function summary(row:Row){const bad=['失败','恢复失败','结果待核对'].includes(String(row.status)),waiting=row.status==='等待审核';const [failureCategory,failureCategoryLabel,troubleshootingHint]=classification(row);return{...project(row),workflowName:row.workflow_name??row.name,priority:bad?'critical':waiting?'warning':'normal',nextAction:bad?'查看失败节点和任务记录':waiting?'处理人工审核':'查看运行详情',failureCategory,failureCategoryLabel,troubleshootingHint}}
function classification(row:Row) {
 const value=[row.status,row.current_node,row.error].join(' ').toLowerCase(),has=(words:string[])=>words.some(w=>value.includes(w))
 if(row.status==='结果待核对')return['needs_reconciliation','外部结果待核对','先核对接收方是否已执行；不能直接重发。']
 if(row.status==='恢复失败')return['resume_failed','恢复执行失败','检查人工审核决策后的恢复日志，确认失败节点可重跑后再重试恢复。']
 if(['需介入','等待审核','绛夊緟瀹℃牳'].includes(String(row.status))||value.includes('人工审核'))return['human_review_blocked','等待人工审核','进入人工审核页确认任务归属、SLA 和审核资格，完成通过、驳回或退回重跑决策。']
 if(has(['鉴权','auth','401','403','凭证','超时','timeout'])&&has(['连接器','connector','工具','tool','api']))return['connector_auth_timeout','连接器鉴权超时','检查连接器凭证、权限范围和上游接口响应时间，必要时刷新授权后重跑失败节点。']
 if(has(['模型','model','llm','provider','deepseek','openai']))return['model_call_failed','模型调用失败','检查模型供应商配置、模型名称、限流和请求上下文；确认后重跑失败节点。']
 if(has(['质量门','质量门禁','quality gate','score','rubric']))return['quality_gate_failed','质量门禁未通过','查看评分维度、门禁阈值和产出物证据，必要时修订产出后提交人工审核。']
 return['失败','澶辫触'].includes(String(row.status))?['unknown','未知异常','查看失败节点错误、审计事件和输入输出上下文，补充明确错误原因后再重跑。']:['normal','无异常','本次运行暂无阻塞原因，可继续查看产出物、节点耗时和成本信号。']
}
/** Read-only bounded projections: no trace backfill or state mutation in GET. */
export async function readClosure(c:SqlClient,ws:string,id:string,operation:string,q:URLSearchParams,options:{costConfigured?:boolean}={}):Promise<unknown> {
 const limit=Number(q.get('limit')??100),offset=Number(q.get('offset')??0)
 if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0||offset>100000)throw new ApiError(422,'分页无效')
 if(operation==='human.list') {
  const vals:unknown[]=[ws],filters=['workspace_id=$1']
  for(const [param,column] of [['status','status'],['reviewerId','assignee_reviewer_id'],['groupId','assignee_group_id']])if(q.has(param)){vals.push(q.get(param));filters.push(`${column}=$${vals.length}`)}
  if(q.get('active')==='true')filters.push("status IN ('待认领','审核中','恢复失败')")
  if(q.has('slaStatus')){vals.push(q.get('slaStatus'));filters.push(`CASE WHEN status NOT IN ('待认领','审核中','恢复失败') THEN sla_status WHEN escalation_at<=now() THEN '已升级' WHEN due_at<=now() THEN '已逾期' WHEN due_at<=now()+interval '30 minutes' THEN '即将到期' ELSE '正常' END=$${vals.length}`)}
  vals.push(limit,offset)
  return(await c.query(`SELECT * FROM human_tasks WHERE ${filters.join(' AND ')} ORDER BY created_at DESC,id LIMIT $${vals.length-1} OFFSET $${vals.length}`,vals)).rows.map(r=>({...project(r),slaStatus:sla(r)}))
 }
 if(operation==='regression.list')return Promise.all((await c.query('SELECT id FROM regression_runs WHERE workspace_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[ws,limit,offset])).rows.map(r=>regressionDetail(c,ws,String(r.id))))
 const table=operation==='reviews.list'?'human_reviews':operation==='evaluation.list'?'evaluations':null
 if(table)return(await c.query(`SELECT * FROM ${table} WHERE workspace_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3`,[ws,limit,offset])).rows.map(project)
 if(operation==='artifacts.list') {
  const vals:unknown[]=[ws],filters=['a.workspace_id=$1']
  if(q.has('schemaValidationStatus')&&!['passed','failed','unchecked'].includes(q.get('schemaValidationStatus')!))throw new ApiError(422,'Schema 校验过滤值无效')
  for(const[param,column]of[['runId','a.run_id'],['sourceNodeRunId','a.source_node_run_id'],['dataObjectDefinitionId','v.data_object_definition_id'],['dataObjectVersionId','v.data_object_version_id']])if(q.has(param)){vals.push(q.get(param));filters.push(`${column}=$${vals.length}`)}
  if(q.has('schemaValidationStatus')){vals.push(q.get('schemaValidationStatus'));filters.push(`runtime_artifact_schema_status(v.content,v.data_object_snapshot)=$${vals.length}`)}
  vals.push(limit,offset)
  return(await c.query(`SELECT a.id artifact_id,v.id artifact_version_id,v.version,a.run_id,a.source_node_run_id,r.name workflow_name,r.status run_status,n.node_name source_node_name,n.node_type source_node_type,n.status source_node_status,n.duration_ms source_node_duration_ms,n.score source_node_score,v.content,a.score,v.data_object_definition_id,v.data_object_version_id,v.data_object_snapshot,v.created_at FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id AND a.workspace_id=v.workspace_id JOIN workflow_runs r ON r.id=a.run_id AND r.workspace_id=a.workspace_id LEFT JOIN node_runs n ON n.id=a.source_node_run_id AND n.workspace_id=a.workspace_id WHERE ${filters.join(' AND ')} ORDER BY v.created_at DESC,v.id LIMIT $${vals.length-1} OFFSET $${vals.length}`,vals)).rows.map(r=>({...project(r),schemaValidation:validateArtifact(String(r.content),r.data_object_snapshot)})).filter(r=>!q.has('schemaValidationStatus')||r.schemaValidation.status===q.get('schemaValidationStatus'))
 }
 if(operation==='evaluation.overview') {
  const totals=(await c.query("SELECT count(*)::int feedback_candidates,count(*) FILTER(WHERE status='pending')::int pending_candidates,count(*) FILTER(WHERE status='confirmed')::int confirmed_candidates,count(DISTINCT workflow_id)::int covered_workflows,count(DISTINCT agent_id)::int covered_agents,(SELECT count(*)::int FROM golden_samples WHERE workspace_id=$1) golden_samples FROM feedback_candidates WHERE workspace_id=$1",[ws])).rows[0]
  return{totals:project(totals),recentCandidates:(await c.query('SELECT * FROM feedback_candidates WHERE workspace_id=$1 ORDER BY created_at DESC,id LIMIT $2',[ws,limit])).rows.map(project)}
 }
 if(operation==='observability.run') {
  const run=(await c.query('SELECT * FROM workflow_runs WHERE workspace_id=$1 AND id=$2',[ws,id])).rows[0];if(!run)throw new ApiError(404,'运行不存在')
  return{...summary(run),nodes:(await c.query('SELECT * FROM node_runs WHERE workspace_id=$1 AND run_id=$2 ORDER BY started_at,id LIMIT 200',[ws,id])).rows.map(r=>({...project(r),input:r.input_text,output:r.output_text})),humanTasks:(await c.query('SELECT * FROM human_tasks WHERE workspace_id=$1 AND workflow_run_id=$2 ORDER BY created_at,id LIMIT 200',[ws,id])).rows.map(r=>({...project(r),slaStatus:sla(r)})),auditEvents:(await c.query('SELECT * FROM audit_events WHERE workspace_id=$1 AND trace_id=$2 ORDER BY created_at,id LIMIT 200',[ws,run.trace_id])).rows.map(project),executionEvents:await events(c,ws,id,limit,offset)}
 }
 if(operation==='observability.read') {
  if(id==='execution-events')return events(c,ws,q.get('runId'),limit,offset,q.get('traceId'))
  if(id==='human-sla') {
   const filter="workspace_id=$1 AND status IN ('待认领','审核中','恢复失败') AND ($2::text IS NULL OR assignee_reviewer_id=$2) AND ($3::text IS NULL OR assignee_group_id=$3)",params=[ws,q.get('reviewerId'),q.get('groupId')]
   const tasks=(await c.query(`SELECT * FROM human_tasks WHERE ${filter} ORDER BY due_at,id LIMIT 200`,params)).rows
   const totals=(await c.query(`SELECT count(*)::int active_tasks,count(*) FILTER(WHERE status='待认领')::int unclaimed,count(*) FILTER(WHERE status='审核中')::int in_review,count(*) FILTER(WHERE due_at>now() AND due_at<=now()+interval '30 minutes')::int due_soon,count(*) FILTER(WHERE due_at<=now() AND escalation_at>now())::int overdue,count(*) FILTER(WHERE escalation_at<=now())::int escalated,count(*) FILTER(WHERE status='恢复失败')::int resume_failed FROM human_tasks WHERE ${filter}`,params)).rows[0]
   return{totals:project(totals),risks:tasks.filter(t=>sla(t)!=='正常').map(t=>({...project(t),taskId:t.id,runId:t.workflow_run_id,slaStatus:sla(t),severity:'warning',nextAction:'处理当前审核任务'})),reviewers:(await c.query('SELECT id,name FROM reviewers WHERE workspace_id=$1 ORDER BY id LIMIT 200',[ws])).rows,groups:(await c.query('SELECT id,name FROM review_groups WHERE workspace_id=$1 ORDER BY id LIMIT 200',[ws])).rows}
  }
  if(id==='cost-usage') {
   const aggregate=(await c.query('SELECT count(*)::int runs,COALESCE(sum(prompt_tokens),0)::int total_prompt_tokens,COALESCE(sum(completion_tokens),0)::int total_completion_tokens,COALESCE(sum(total_tokens),0)::int total_tokens,COALESCE(sum(cost_usd),0) total_cost_usd FROM workflow_runs WHERE workspace_id=$1',[ws])).rows[0]
   const groups=(await c.query('SELECT model name,count(*)::int runs,sum(prompt_tokens)::int prompt_tokens,sum(completion_tokens)::int completion_tokens,sum(total_tokens)::int total_tokens,sum(cost_usd) cost_usd,avg(score)::int average_score FROM workflow_runs WHERE workspace_id=$1 GROUP BY model ORDER BY model LIMIT 200',[ws])).rows.map(project)
   const workflow=(await c.query('SELECT name,count(*)::int runs,sum(prompt_tokens)::int prompt_tokens,sum(completion_tokens)::int completion_tokens,sum(total_tokens)::int total_tokens,sum(cost_usd) cost_usd,avg(score)::int average_score FROM workflow_runs WHERE workspace_id=$1 GROUP BY name ORDER BY name LIMIT 200',[ws])).rows.map(project)
   const byDay=(await c.query("SELECT to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD') name,count(*)::int runs,sum(prompt_tokens)::int prompt_tokens,sum(completion_tokens)::int completion_tokens,sum(total_tokens)::int total_tokens,sum(cost_usd) cost_usd FROM workflow_runs WHERE workspace_id=$1 GROUP BY 1 ORDER BY 1 DESC LIMIT 200",[ws])).rows.map(project)
   return{costConfigured:options.costConfigured===true,totals:project(aggregate),byModel:groups,byWorkflow:workflow,byDay}
  }
  const runs=(await c.query('SELECT * FROM workflow_runs WHERE workspace_id=$1 ORDER BY started_at DESC,id LIMIT $2 OFFSET $3',[ws,limit,offset])).rows
  const totals=(await c.query("SELECT count(*)::int runs,count(*) FILTER(WHERE status IN ('已完成','完成','成功'))::int succeeded,count(*) FILTER(WHERE status='失败')::int failed,count(*) FILTER(WHERE status='等待审核')::int waiting_for_human,count(*) FILTER(WHERE status='恢复失败')::int resume_failed,avg(duration_ms)::int average_duration_ms,COALESCE(sum(prompt_tokens),0)::int total_prompt_tokens,COALESCE(sum(completion_tokens),0)::int total_completion_tokens,COALESCE(sum(cost_usd),0) total_cost_usd FROM workflow_runs WHERE workspace_id=$1",[ws])).rows[0]
  const alerts=(await c.query("SELECT n.* FROM notification_outbox n WHERE n.workspace_id=$1 AND (n.status IN ('failed','needs_reconciliation') OR n.event_type IN ('human_task.overdue','human_task.escalated')) ORDER BY n.created_at DESC,n.id LIMIT $2",[ws,limit])).rows.map(n=>({...project(n),severity:'warning',channel:(n.payload as Row)?.channel??'in_app',title:n.event_type,message:'通知或审核事件需要处理',runId:(n.payload as Row)?.runId??null,nextAction:n.status==='needs_reconciliation'?'核对接收方结果':'查看关联审核和投递记录'}))
  return{totals:{...project(totals),totalRuns:totals.runs,succeededRuns:totals.succeeded,failedRuns:totals.failed},risks:runs.filter(r=>['失败','恢复失败','结果待核对'].includes(String(r.status))).map(r=>({runId:r.id,title:r.name,severity:'critical',message:'运行需要处理',nextAction:'查看任务失败记录'})),alerts,recentRuns:runs.map(summary)}
 }
 throw new ApiError(404,'Not Found')
}
async function events(c:SqlClient,ws:string,runId:string|null,limit:number,offset:number,traceId:string|null=null) {
 return(await c.query(`SELECT e.id,e.event_type type,e.event_type title,o.status,COALESCE(r.trace_id,'') trace_id,NULL span_id,'workflow_run' source_type,r.id source_id,e.created_at occurred_at,e.event_type summary FROM runtime_operation_events e JOIN runtime_operations o ON o.id=e.operation_id AND o.workspace_id=e.workspace_id JOIN workflow_runs r ON r.id=CASE WHEN o.kind IN ('workflow.run','agent.run') THEN o.target_id ELSE o.input->>'runId' END AND r.workspace_id=o.workspace_id WHERE e.workspace_id=$1 AND ($2::text IS NULL OR r.id=$2) AND ($5::text IS NULL OR r.trace_id=$5) ORDER BY e.created_at DESC,e.id LIMIT $3 OFFSET $4`,[ws,runId,limit,offset,traceId])).rows.map(project)
}
