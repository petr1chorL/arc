export const WORKSPACE_ROLES = ['viewer', 'operator', 'builder', 'workspace_admin'] as const

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

const roleLevel: Record<WorkspaceRole, number> = {
  viewer: 10,
  operator: 20,
  builder: 30,
  workspace_admin: 40,
}

const capabilityMinRole = {
  'asset.read': 'viewer',
  'run.read': 'viewer',
  'run.execute': 'operator',
  'evaluation.run': 'operator',
  'agent.write': 'builder',
  'agent.publish': 'builder',
  'rubric.write': 'builder',
  'rubric.publish': 'builder',
  'workflow.write': 'builder',
  'workflow.publish': 'builder',
  'asset.deactivate': 'workspace_admin',
  'member.manage': 'workspace_admin',
  'reviewer.manage': 'workspace_admin',
  'workspace.manage': 'workspace_admin',
  'audit.read': 'workspace_admin',
  'audit.export': 'workspace_admin',
} as const satisfies Record<string, WorkspaceRole>

export type Capability = keyof typeof capabilityMinRole

const capabilityLabels: Partial<Record<Capability, string>> = {
  'asset.read': '读取资产',
  'run.read': '读取运行',
  'run.execute': '执行运行',
  'evaluation.run': '执行评估',
  'agent.write': '编辑 Agent',
  'agent.publish': '发布 Agent',
  'rubric.write': '编辑 Rubric',
  'rubric.publish': '发布 Rubric',
  'workflow.write': '编辑工作流',
  'workflow.publish': '发布工作流',
  'asset.deactivate': '停用资产',
  'member.manage': '管理成员',
  'reviewer.manage': '管理 Reviewer 资格',
  'workspace.manage': '管理 Workspace',
  'audit.read': '读取审计',
  'audit.export': '导出审计',
}

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('und')
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && WORKSPACE_ROLES.includes(value as WorkspaceRole)
}

export function can(role: WorkspaceRole, capability: Capability): boolean {
  return roleLevel[role] >= roleLevel[capabilityMinRole[capability]]
}

export function buildPermissionMatrix() {
  const capabilities = Object.entries(capabilityMinRole)
    .sort((left, right) => {
      const roleDifference = roleLevel[left[1]] - roleLevel[right[1]]
      return roleDifference || left[0].localeCompare(right[0])
    })
    .map(([key, requiredRole]) => ({
      key: key as Capability,
      label: capabilityLabels[key as Capability] ?? key,
      requiredRole,
    }))

  return {
    roles: [...WORKSPACE_ROLES],
    capabilities,
    matrix: WORKSPACE_ROLES.map((role) => ({
      role,
      capabilities: Object.fromEntries(
        capabilities.map(({ key }) => [key, can(role, key)]),
      ) as Record<Capability, boolean>,
    })),
    reviewerQualificationNote:
      'Reviewer 是人工任务处理的业务资格，不等于平台角色；成员需要同时具备有效 Membership 和 Reviewer 资格才能处理对应人工任务。',
  }
}
