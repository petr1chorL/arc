import type { Operation } from './types.ts'
import { approvalOutcome } from '../runtime-closure/policy.ts'

type Row = Record<string, unknown>
type ResumeOperation = Pick<Operation, 'kind' | 'status' | 'workspace_id' | 'target_id' | 'input'>

/** Restore only a failed projection whose complete persisted decision chain matches this success. */
export function recoveredHumanTaskStatus(op: ResumeOperation, task: Row | undefined, resume: Row | undefined,
  decisions: Row[]): '已通过' | '修改后通过' | '已驳回' | '已退回' | null {
  if (op.kind !== 'human.resume' || op.status !== 'succeeded' || !task || !resume || task.status !== '恢复失败') return null
  const input = op.input
  if ([op.workspace_id, input.runId, input.humanTaskId, input.resumeRequestId, input.decisionId].some(value => typeof value !== 'string' || !value)
    || task.workspace_id !== op.workspace_id || task.id !== input.humanTaskId || task.workflow_run_id !== input.runId
    || resume.workspace_id !== op.workspace_id || resume.id !== input.resumeRequestId || op.target_id !== resume.id
    || resume.human_task_id !== task.id || resume.decision_id !== input.decisionId || resume.action !== input.action
    || resume.status !== 'succeeded') return null
  const participants = task.participant_snapshot
  if (!Array.isArray(participants) || !participants.length || participants.some(value => typeof value !== 'string' || !value)
    || new Set(participants).size !== participants.length || !Number.isInteger(task.required_approvals)
    || !decisions.length || !decisions.some(decision => decision.id === input.decisionId && participants.includes(decision.reviewer_id))
    || decisions.some(decision => decision.workspace_id !== op.workspace_id || decision.human_task_id !== task.id
      || typeof decision.reviewer_id !== 'string' || !decision.reviewer_id
      || !['approve', 'modify_and_approve', 'reject', 'return_for_rerun'].includes(String(decision.decision)))
    || new Set(decisions.map(decision => decision.reviewer_id)).size !== decisions.length) return null
  let outcome: string
  try {
    outcome = approvalOutcome(String(task.review_policy), Number(task.required_approvals), participants,
      decisions.map(decision => ({ reviewer_id: String(decision.reviewer_id), decision: String(decision.decision) })))
  } catch { return null }
  if (outcome !== input.action) return null
  if (outcome === 'reject') return '已驳回'
  if (outcome === 'return_for_rerun') return '已退回'
  if (outcome !== 'approve') return null
  return decisions.some(decision => decision.decision === 'modify_and_approve') ? '修改后通过' : '已通过'
}
