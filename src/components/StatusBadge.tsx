import { displayStatus } from '../domain/statusText'

export function StatusBadge({ status }: { status: string }) {
  const label = displayStatus(status)
  const tone: Record<string, string> = {
    在线: 'success',
    调试中: 'warning',
    已停用: 'neutral',
    运行中: 'info',
    已完成: 'success',
    需介入: 'warning',
    失败: 'danger',
    待处理: 'warning',
    处理中: 'info',
    待认领: 'warning',
    审核中: 'info',
    已通过: 'success',
    修改后通过: 'success',
    已驳回: 'danger',
    已退回: 'warning',
    恢复失败: 'danger',
    等待审核: 'warning',
    高: 'danger',
    中: 'warning',
    低: 'neutral',
  }

  return <span className={`status-badge ${tone[label] ?? 'neutral'}`}><i />{label}</span>
}
