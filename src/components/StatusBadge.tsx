import type { AgentStatus, ReviewStatus, RunStatus } from '../types'

type Status = AgentStatus | RunStatus | ReviewStatus | '高' | '中' | '低'

export function StatusBadge({ status }: { status: Status }) {
  const tone: Record<Status, string> = {
    在线: 'success',
    调试中: 'warning',
    已停用: 'neutral',
    运行中: 'info',
    已完成: 'success',
    需介入: 'warning',
    失败: 'danger',
    待处理: 'warning',
    处理中: 'info',
    高: 'danger',
    中: 'warning',
    低: 'neutral',
  }

  return <span className={`status-badge ${tone[status]}`}><i />{status}</span>
}
