import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { ApiError } from '../identity-workspace/handler.ts'
import type { SqlClient } from '../identity-workspace/postgres.ts'
import { approvalOutcome, parseDecision, project, text } from './policy.ts'
import type { ClosureDeps, Row } from './types.ts'
const active = ['待认领','审核中']
export async function taskRow(c:SqlClient,ws:string,id:string,lock=false):Promise<Row> {const r=(await c.query(`SELECT * FROM human_tasks WHERE workspace_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[ws,id])).rows[0];if(!r)throw new ApiError(404,'审核任务不存在');return r}
async function reviewer(c:SqlClient,ws:string,user:string):Promise<Row> {const r=(await c.query('SELECT r.* FROM reviewers r JOIN users u ON u.id=r.user_id JOIN workspace_memberships m ON m.user_id=u.id AND m.workspace_id=r.workspace_id WHERE r.workspace_id=$1 AND r.user_id=$2 AND r.is_active=true AND u.status=\'active\' AND m.status=\'active\' FOR SHARE OF r,m,u',[ws,user])).rows[0];if(!r)throw new ApiError(403,'需要当前 Workspace 的有效审核员资格');return r}
async function validReviewers(c:SqlClient,ws:string,ids:string[]) { const rows=(await c.query('SELECT r.id FROM reviewers r JOIN users u ON u.id=r.user_id JOIN workspace_memberships m ON m.user_id=u.id AND m.workspace_id=r.workspace_id WHERE r.workspace_id=$1 AND r.id=ANY($2::text[]) AND r.is_active=true AND u.status=\'active\' AND m.status=\'active\' FOR SHARE OF r,m,u',[ws,ids])).rows; if(!ids.length||rows.length!==new Set(ids).size)throw new ApiError(422,'审核参与者必须属于当前 Workspace 且有效'); }
/** Called inside the workflow transaction after persisting source artifact and human node. */
export async function pauseForReview(c:SqlClient,args:{workspaceId:string;runId:string;nodeRunId:string;nodeId:string;sourceNodeId:string;config:Row;artifactVersionId:string;actorId:string}) {
  const {workspaceId:ws,runId,nodeRunId,config}=args
  const existing=(await c.query('SELECT * FROM human_tasks WHERE workspace_id=$1 AND node_run_id=$2',[ws,nodeRunId])).rows[0];if(existing)return project(existing)
  if(!(await c.query('SELECT r.id FROM workflow_runs r JOIN node_runs n ON n.run_id=r.id AND n.workspace_id=r.workspace_id JOIN artifacts a ON a.run_id=r.id AND a.workspace_id=r.workspace_id JOIN artifact_versions v ON v.artifact_id=a.id AND v.workspace_id=r.workspace_id WHERE r.workspace_id=$1 AND r.id=$2 AND n.id=$3 AND v.id=$4',[ws,runId,nodeRunId,args.artifactVersionId])).rows.length)throw new ApiError(422,'审核运行与产出物关联无效')
  let ids=Array.isArray(config.reviewerIds)?config.reviewerIds.map(x=>text(x,36)):[]
  const groupId=config.groupId==null?null:text(config.groupId,36)
  const group=groupId?(await c.query('SELECT * FROM review_groups WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[ws,groupId])).rows[0]:null
  if(groupId&&!group)throw new ApiError(422,'审核组不存在')
  const escalationGroupId=config.escalationGroupId==null?null:text(config.escalationGroupId,36)
  if(escalationGroupId&&!(await c.query('SELECT id FROM review_groups WHERE workspace_id=$1 AND id=$2 AND is_escalation_group=true FOR SHARE',[ws,escalationGroupId])).rows.length)throw new ApiError(422,'升级审核组无效')
  if(!ids.length&&group)ids=(await c.query('SELECT reviewer_id FROM review_group_members WHERE workspace_id=$1 AND group_id=$2 ORDER BY id',[ws,groupId])).rows.map(r=>String(r.reviewer_id))
  ids=[...new Set(ids)];await validReviewers(c,ws,ids)
  const policy=String(config.reviewPolicy??'any_one'),required=Number(config.requiredApprovals??1)
  approvalOutcome(policy,required,ids,[])
  const assignment=String(config.assignmentType??'group_claim')
  if(!['group_claim','direct','direct_reviewer','round_robin'].includes(assignment))throw new ApiError(422,'审核分配模式无效')
  let assignee:string|null=null
  if(assignment==='round_robin') {if(!group)throw new ApiError(422,'轮询分配需要审核组');assignee=ids[Number(group.rotation_cursor)%ids.length];await c.query('UPDATE review_groups SET rotation_cursor=rotation_cursor+1 WHERE workspace_id=$1 AND id=$2',[ws,groupId])}
  if(['direct','direct_reviewer'].includes(assignment))assignee=ids[0]
  const due=Number(config.dueMinutes??240),escalation=Number(config.escalationMinutes??480)
  if(!Number.isInteger(due)||!Number.isInteger(escalation)||due<1||escalation<=due||escalation>525600)throw new ApiError(422,'审核 SLA 无效')
  const id=randomUUID(),now=new Date()
  await c.query(`INSERT INTO human_tasks (id,workspace_id,workflow_run_id,node_run_id,human_node_id,source_node_id,artifact_version_id,title,status,assignment_type,assignee_reviewer_id,assignee_group_id,review_policy,required_approvals,participant_snapshot,due_at,escalation_at,sla_status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'正常',$18,$18)`,[id,ws,runId,nodeRunId,args.nodeId,args.sourceNodeId,args.artifactVersionId,String(config.label??'人工审核'),assignee?'审核中':'待认领',assignment,assignee,groupId,policy,required,JSON.stringify(ids),new Date(+now+due*60000),new Date(+now+escalation*60000),now])
  if(escalationGroupId)await c.query('UPDATE human_tasks SET escalation_group_id=$1 WHERE workspace_id=$2 AND id=$3',[escalationGroupId,ws,id])
  await c.query("UPDATE workflow_runs SET status='等待审核' WHERE workspace_id=$1 AND id=$2",[ws,runId])
  await c.query("UPDATE node_runs SET status='等待审核' WHERE workspace_id=$1 AND id=$2",[ws,nodeRunId])
  await c.query(`INSERT INTO notification_outbox(id,workspace_id,event_key,human_task_id,event_type,recipient_type,recipient_id,payload,status,created_at) VALUES($1,$2,$3,$4,'human_task.created',$5,$6,$7,'pending',now())`,[randomUUID(),ws,`human-task:${id}:created`,id,assignee?'reviewer':'group',assignee??groupId??ids[0],JSON.stringify({channel:'in_app',runId,traceId:`trace-${runId}`})])
  return project(await taskRow(c,ws,id))
}
/** Lock task and live qualification before ownership or vote mutation. */
export async function mutateHuman(c:SqlClient,ws:string,id:string,userId:string,action:string,body:unknown,deps:ClosureDeps) {
  const task=await taskRow(c,ws,id,true),actor=await reviewer(c,ws,userId),rid=String(actor.id)
  const participants=task.participant_snapshot as string[]
  if(!participants.includes(rid))throw new ApiError(403,'不在固定审核参与者中')
  if(action==='decisions') {
    const run=(await c.query('SELECT status FROM workflow_runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[ws,task.workflow_run_id])).rows[0]
    if(!run||['已取消','已终止'].includes(String(run.status)))throw new ApiError(409,'运行已取消或终止，不能提交审核决定')
    const decision=parseDecision(body)
    const old=(await c.query('SELECT * FROM review_decisions WHERE workspace_id=$1 AND idempotency_key=$2',[ws,decision.idempotencyKey])).rows[0]
    if(old) {if(old.human_task_id!==id||old.reviewer_id!==rid||!isDeepStrictEqual(old.request_body,decision))throw new ApiError(409,'幂等键请求不一致');return {body:await humanDetail(c,ws,id)}}
    if(!active.includes(String(task.status)))throw new ApiError(409,'审核任务已结束')
    if(task.assignee_reviewer_id && task.assignee_reviewer_id!==rid && task.review_policy==='any_one')throw new ApiError(403,'任务属于其他审核员')
    if(task.artifact_version_id!==decision.artifactVersionId)throw new ApiError(409,'产出物版本已变化')
    if((await c.query('SELECT id FROM review_decisions WHERE workspace_id=$1 AND human_task_id=$2 AND reviewer_id=$3',[ws,id,rid])).rows.length)throw new ApiError(409,'审核员已提交决定')
    const did=randomUUID();let version=decision.artifactVersionId
    if(decision.decision==='modify_and_approve')version=await modifyArtifact(c,ws,task,did,rid,decision)
    await c.query('INSERT INTO review_decisions(id,workspace_id,human_task_id,reviewer_id,decision,reason,artifact_version_id,idempotency_key,tags,request_body,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())',[did,ws,id,rid,decision.decision,decision.reason,version,decision.idempotencyKey,JSON.stringify(decision.tags),JSON.stringify(decision)])
    const votes=(await c.query<{reviewer_id:string;decision:string}>('SELECT reviewer_id,decision FROM review_decisions WHERE workspace_id=$1 AND human_task_id=$2',[ws,id])).rows
    const outcome=approvalOutcome(String(task.review_policy),Number(task.required_approvals),participants,votes)
    const status=outcome==='pending'?'审核中':outcome==='reject'?'已驳回':outcome==='return_for_rerun'?'已退回':votes.some(v=>v.decision==='modify_and_approve')?'修改后通过':'已通过'
    await c.query('UPDATE human_tasks SET status=$1,artifact_version_id=$2,updated_at=now() WHERE workspace_id=$3 AND id=$4',[status,version,ws,id])
    await humanEvent(c,ws,task,rid,'human_task.decision',decision.reason,status,{decisionId:did,decision:decision.decision,artifactVersionId:version})
    if(outcome!=='pending') {
      const resumeId=randomUUID()
      await c.query("INSERT INTO resume_requests(id,workspace_id,human_task_id,decision_id,action,status,error,created_at) VALUES($1,$2,$3,$4,$5,'queued','',now())",[resumeId,ws,id,did,outcome])
      const op=await deps.enqueue(c,{workspaceId:ws,kind:'human.resume',idempotencyKey:`human-resume:${id}:${did}`,targetId:resumeId,actorId:userId,input:{runId:task.workflow_run_id,humanTaskId:id,resumeRequestId:resumeId,decisionId:did,action:outcome,artifactVersionId:version}})
      return {body:{...await humanDetail(c,ws,id),resumeOperation:{operationId:op.id,status:op.status,statusUrl:`/api/workspaces/${ws}/operations/${op.id}`,runId:task.workflow_run_id}}}
    }
  } else {
    if(!active.includes(String(task.status)))throw new ApiError(409,'审核任务已结束')
    if(action==='claim') {
      if(body&&typeof body==='object'&&Object.keys(body).length)throw new ApiError(422,'认领请求不接受额外字段')
      if(task.assignee_reviewer_id && task.assignee_reviewer_id!==rid)throw new ApiError(409,'任务已被认领')
      await c.query("UPDATE human_tasks SET assignee_reviewer_id=$1,status='审核中',updated_at=now() WHERE workspace_id=$2 AND id=$3",[rid,ws,id])
      await humanEvent(c,ws,task,rid,'human_task.claim','认领审核任务','审核中',{})
    } else if(action==='transfer') {
      const b=body as Row;text(b?.reason,1000)
      if(Object.keys(b).some(k=>!['reason','targetReviewerId','groupId'].includes(k))||!!b.targetReviewerId===!!b.groupId)throw new ApiError(422,'必须提供一个转交目标')
      if(task.assignee_reviewer_id!==rid)throw new ApiError(403,'只有当前认领人可以转交')
      if(b.targetReviewerId) {const target=text(b.targetReviewerId,36);await validReviewers(c,ws,[target]);const updated=[...new Set([...participants,target])];await c.query("UPDATE human_tasks SET assignee_reviewer_id=$1,participant_snapshot=$4,status='审核中',updated_at=now() WHERE workspace_id=$2 AND id=$3",[target,ws,id,JSON.stringify(updated)])}
      else {
        const groupId=text(b.groupId,36)
        if(!(await c.query('SELECT id FROM review_groups WHERE workspace_id=$1 AND id=$2 FOR SHARE',[ws,groupId])).rows.length)throw new ApiError(422,'审核组不存在')
        const updated=(await c.query('SELECT reviewer_id FROM review_group_members WHERE workspace_id=$1 AND group_id=$2 ORDER BY id',[ws,groupId])).rows.map(r=>String(r.reviewer_id))
        await validReviewers(c,ws,updated);approvalOutcome(String(task.review_policy),Number(task.required_approvals),updated,[])
        await c.query("UPDATE human_tasks SET assignee_reviewer_id=NULL,assignee_group_id=$3,participant_snapshot=$4,status='待认领',updated_at=now() WHERE workspace_id=$1 AND id=$2",[ws,id,groupId,JSON.stringify(updated)])
      }
      await humanEvent(c,ws,task,rid,'human_task.transfer',String(b.reason),String(task.status),{targetReviewerId:b.targetReviewerId??null,groupId:b.groupId??null})
    } else throw new ApiError(404,'Not Found')
  }
  return {body:await humanDetail(c,ws,id)}
}
async function humanEvent(c:SqlClient,ws:string,task:Row,actor:string,type:string,reason:string,after:string,payload:Row) {
 const trace=(await c.query('SELECT trace_id FROM workflow_runs WHERE workspace_id=$1 AND id=$2',[ws,task.workflow_run_id])).rows[0]?.trace_id??''
 await c.query('INSERT INTO audit_events(id,workspace_id,human_task_id,event_type,actor_id,reason,before_status,after_status,payload,trace_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())',[randomUUID(),ws,task.id,type,actor,reason,task.status,after,JSON.stringify(payload),trace])
}
async function modifyArtifact(c:SqlClient,ws:string,task:Row,did:string,rid:string,d:ReturnType<typeof parseDecision>) {
  const old=(await c.query('SELECT v.* FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id AND a.workspace_id=v.workspace_id WHERE v.workspace_id=$1 AND v.id=$2 AND a.run_id=$3 FOR UPDATE OF a',[ws,d.artifactVersionId,task.workflow_run_id])).rows[0]
  if(!old)throw new ApiError(409,'产出物版本不存在')
  const version=randomUUID(),diff=randomUUID()
  const num=(await c.query('SELECT COALESCE(max(version),0)+1 n FROM artifact_versions WHERE workspace_id=$1 AND artifact_id=$2',[ws,old.artifact_id])).rows[0].n
  await c.query('INSERT INTO artifact_versions(id,workspace_id,artifact_id,version,parent_version_id,content,data_object_definition_id,data_object_version_id,data_object_snapshot,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())',[version,ws,old.artifact_id,num,old.id,d.modifiedContent,old.data_object_definition_id,old.data_object_version_id,JSON.stringify(old.data_object_snapshot),rid])
  await c.query('INSERT INTO artifact_diffs(id,workspace_id,human_task_id,from_version_id,to_version_id,old_content,new_content,unified_diff,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())',[diff,ws,task.id,old.id,version,old.content,d.modifiedContent,`--- original\n+++ modified\n-${String(old.content).replaceAll('\n','\n-')}\n+${String(d.modifiedContent).replaceAll('\n','\n+')}`])
  const run=(await c.query('SELECT workflow_id FROM workflow_runs WHERE workspace_id=$1 AND id=$2',[ws,task.workflow_run_id])).rows[0]
  await c.query('INSERT INTO feedback_candidates(id,workspace_id,human_task_id,decision_id,original_version_id,modified_version_id,diff_id,reason,tags,workflow_run_id,workflow_id,source_node_id,created_by,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,\'待确认\',now())',[randomUUID(),ws,task.id,did,old.id,version,diff,d.reason,JSON.stringify(d.tags),task.workflow_run_id,run.workflow_id,task.source_node_id,rid])
  return version
}
export async function humanDetail(c:SqlClient,ws:string,id:string) {
  const task=await taskRow(c,ws,id)
  const versions=(await c.query('SELECT v.* FROM artifact_versions v WHERE v.workspace_id=$1 AND v.artifact_id=(SELECT artifact_id FROM artifact_versions WHERE workspace_id=$1 AND id=$2) ORDER BY version',[ws,task.artifact_version_id])).rows.map(project)
  const decisions=(await c.query('SELECT * FROM review_decisions WHERE workspace_id=$1 AND human_task_id=$2 ORDER BY created_at,id',[ws,id])).rows
  const run=(await c.query('SELECT id,name,status,current_node,score FROM workflow_runs WHERE workspace_id=$1 AND id=$2',[ws,task.workflow_run_id])).rows[0]
  return {...project(task),artifact:versions.find(v=>v.id===task.artifact_version_id),run:run?project(run):null,
    approvalProgress:{required:task.review_policy==='all'?(task.participant_snapshot as string[]).length:task.review_policy==='any_one'?1:task.required_approvals,received:decisions.filter(d=>['approve','modify_and_approve'].includes(String(d.decision))).length},
    auditEvents:(await c.query('SELECT * FROM audit_events WHERE workspace_id=$1 AND human_task_id=$2 ORDER BY created_at,id LIMIT 200',[ws,id])).rows.map(project),
    notifications:(await c.query('SELECT * FROM notification_outbox WHERE workspace_id=$1 AND human_task_id=$2 ORDER BY created_at,id LIMIT 200',[ws,id])).rows.map(project),
    artifactVersions:versions,decisions:decisions.map(project),resumeRequests:(await c.query('SELECT * FROM resume_requests WHERE workspace_id=$1 AND human_task_id=$2 ORDER BY created_at,id',[ws,id])).rows.map(project)}
}
