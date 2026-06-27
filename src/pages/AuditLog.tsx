import { useEffect, useMemo, useState } from 'react'
import { FileClock, RefreshCw } from 'lucide-react'
import { useWorkspace } from '../auth/workspaceContextState'
import { listWorkspaceAuditEvents } from '../api/audit'
import type { WorkspaceAuditEvent } from '../types'

const sensitiveMetadataPattern = /(api[_-]?key|token|cookie|secret|password|env)/i

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function metadataSummary(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata)
    .filter(([key]) => !sensitiveMetadataPattern.test(key))
    .slice(0, 3)
  if (entries.length === 0) return '无附加上下文'
  return entries.map(([key, value]) => {
    const rendered = Array.isArray(value)
      ? value.join(', ')
      : typeof value === 'object' && value !== null
        ? JSON.stringify(value)
        : String(value)
    return `${key}: ${rendered}`
  }).join(' · ')
}

function eventTitle(event: WorkspaceAuditEvent) {
  return event.targetType && event.targetId
    ? `${event.targetType} / ${event.targetId}`
    : event.targetType ?? 'workspace'
}

export function AuditLog() {
  const { workspace } = useWorkspace()
  const [events, setEvents] = useState<WorkspaceAuditEvent[]>([])
  const [action, setAction] = useState('')
  const [targetType, setTargetType] = useState('')
  const [outcome, setOutcome] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const filters = useMemo(() => ({
    action: action.trim() || undefined,
    targetType: targetType.trim() || undefined,
    outcome: outcome || undefined,
    limit: 50,
  }), [action, targetType, outcome])

  async function loadEvents() {
    setIsLoading(true)
    setError('')
    try {
      const nextEvents = await listWorkspaceAuditEvents(workspace.id, filters)
      setEvents(nextEvents)
    } catch (err) {
      setError(err instanceof Error ? err.message : '审计日志加载失败')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, filters])

  return (
    <div className="page-stack">
      <section className="panel page-toolbar">
        <div>
          <p>WORKSPACE AUDIT</p>
          <h2>Workspace 审计事件</h2>
        </div>
        <button className="button secondary" type="button" onClick={loadEvents} disabled={isLoading}>
          <RefreshCw size={16} />
          刷新
        </button>
      </section>

      <section className="panel observability-filter-bar">
        <label>
          <span>动作</span>
          <input
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="agent.publish"
          />
        </label>
        <label>
          <span>对象类型</span>
          <input
            value={targetType}
            onChange={(event) => setTargetType(event.target.value)}
            placeholder="tool_skill_asset"
          />
        </label>
        <label>
          <span>结果</span>
          <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
            <option value="">全部</option>
            <option value="success">success</option>
            <option value="denied">denied</option>
            <option value="failure">failure</option>
          </select>
        </label>
      </section>

      <section className="panel execution-event-list">
        {isLoading && <div className="table-state">正在加载审计事件…</div>}
        {error && <div className="table-state error">{error}</div>}
        {!isLoading && !error && events.length === 0 && (
          <div className="table-state">暂无审计事件。</div>
        )}
        {!isLoading && !error && events.map((event) => (
          <article className={`execution-event ${event.outcome === 'success' ? 'success' : 'failed'}`} key={event.id}>
            <FileClock size={18} />
            <time>{formatDate(event.createdAt)}</time>
            <div>
              <strong>{event.action}</strong>
              <span>{eventTitle(event)}</span>
              <p>{event.reason || metadataSummary(event.metadata)}</p>
              {event.reason && <p>{metadataSummary(event.metadata)}</p>}
            </div>
            <em>{event.outcome}</em>
            <span>{event.actorId ?? 'system'}</span>
            <small>{event.requestId ?? event.traceId}</small>
          </article>
        ))}
      </section>
    </div>
  )
}
