import { ApiError } from '../identity-workspace/handler.ts'
import { createTransactionBackend, workspaceContext, requireCapability, type SqlPool } from '../identity-workspace/postgres.ts'
import type { WorkflowsInput } from './handler.ts'

type ReviewerRow = {
  id: string; user_id: string | null; name: string; role: string; is_expert: boolean; is_active: boolean
}
type GroupRow = { id: string; name: string; assignment_mode: string; is_escalation_group: boolean }

/** Read-only compiler dependencies. No seed, qualification management or task creation. */
export function createPostgresWorkflowDirectoryBackend(pool: SqlPool) {
  return createTransactionBackend<WorkflowsInput>(pool, async (client, input) => {
    const { operation } = input.route
    const context = await workspaceContext(client, input)
    if (operation !== 'reviewers' && operation !== 'review-groups') {
      throw new ApiError(501, '工作流生命周期接口尚未迁移')
    }
    await requireCapability(client, context, input, 'asset.read', {
      action: operation === 'reviewers' ? 'reviewer.list' : 'review_group.list',
      targetType: 'workspace', targetId: context.workspace.id,
    })
    if (operation === 'reviewers') {
      const result = await client.query<ReviewerRow>(
        'SELECT id,user_id,name,role,is_expert,is_active FROM reviewers WHERE workspace_id=$1 ORDER BY created_at ASC', [context.workspace.id])
      return { body: result.rows.map(projectReviewer) }
    }
    const groups = await client.query<GroupRow>(
      'SELECT id,name,assignment_mode,is_escalation_group FROM review_groups WHERE workspace_id=$1 ORDER BY created_at ASC', [context.workspace.id])
    const members = await client.query<ReviewerRow & { group_id: string }>(
      `SELECT r.id,r.user_id,r.name,r.role,r.is_expert,r.is_active,m.group_id FROM review_group_members m
       JOIN reviewers r ON r.id=m.reviewer_id AND r.workspace_id=m.workspace_id
       JOIN review_groups g ON g.id=m.group_id AND g.workspace_id=m.workspace_id
       WHERE m.workspace_id=$1 ORDER BY r.created_at ASC`, [context.workspace.id])
    return { body: groups.rows.map(group => ({ id: group.id, name: group.name,
      assignmentMode: group.assignment_mode, isEscalationGroup: group.is_escalation_group,
      members: members.rows.filter(member => member.group_id === group.id).map(projectReviewer),
    })) }
  })
}

function projectReviewer(row: ReviewerRow) {
  return { id: row.id, userId: row.user_id, name: row.name, role: row.role,
    isExpert: row.is_expert, isActive: row.is_active }
}
