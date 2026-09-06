/** Local migration verification only; production keeps the existing capabilities by default. */
export function isRuntimeMigration(): boolean {
  return import.meta.env.VITE_ARC_ONE_MIGRATION_MODE === 'runtime'
}

export function isReferenceAssetMigration(): boolean {
  return ['reference-assets', 'agents', 'data-objects', 'rubric-samples', 'workflows', 'runtime'].includes(import.meta.env.VITE_ARC_ONE_MIGRATION_MODE)
}

/** Tool Operation readiness does not enable Provider configuration tests or earlier migration stages. */
export function isToolTestAvailable(): boolean {
  return isRuntimeMigration() || !isReferenceAssetMigration()
}

export function isAgentMigration(): boolean {
  return ['agents', 'data-objects', 'rubric-samples', 'workflows', 'runtime'].includes(import.meta.env.VITE_ARC_ONE_MIGRATION_MODE)
}

export function isDataObjectMigration(): boolean {
  return ['data-objects', 'rubric-samples', 'workflows', 'runtime'].includes(import.meta.env.VITE_ARC_ONE_MIGRATION_MODE)
}

export function isRubricSampleMigration(): boolean {
  return ['rubric-samples', 'workflows', 'runtime'].includes(import.meta.env.VITE_ARC_ONE_MIGRATION_MODE)
}

export function isWorkflowMigration(): boolean {
  return ['workflows', 'runtime'].includes(import.meta.env.VITE_ARC_ONE_MIGRATION_MODE)
}

export const workflowMigrationNotice = '工作流迁移验证模式：仅编排、校验与版本治理，运行尚未迁移。'

export const agentMigrationNotice = 'Agent 迁移验证模式：仅资产治理，测试运行尚未迁移。'

export const referenceAssetMigrationNotice = '资产迁移验证模式：仅登记与读取，测试调用尚未迁移。'

export const toolTestMigrationNotice = '工具测试迁移验证模式：HTTP 测试异步受理，执行结果以持久化任务为准；MCP 仅记录未配置失败。'
