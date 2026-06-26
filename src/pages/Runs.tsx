import { Play, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../auth/WorkspaceContext'
import { listRuns } from '../api/execution'
import { StatusBadge } from '../components/StatusBadge'
import type { ExecutionRun, NodeExecution } from '../types'

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(2)} s`
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

export function Runs() {
  const { workspace } = useWorkspace()
  const [runs, setRuns] = useState<ExecutionRun[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const nextRuns = await listRuns(workspace.id)
      setRuns(nextRuns)
      setSelectedId((current) => (
        nextRuns.some((run) => run.id === current) ? current : nextRuns[0]?.id ?? ''
      ))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '运行记录加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [workspace.id])

  useEffect(() => {
    void load()
  }, [load])

  const filteredRuns = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return runs
    return runs.filter((run) => (
      run.name.toLowerCase().includes(keyword)
      || run.id.toLowerCase().includes(keyword)
      || run.status.toLowerCase().includes(keyword)
    ))
  }, [query, runs])
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0]

  if (isLoading) {
    return <div className="panel table-state">正在加载运行记录…</div>
  }
  if (error) {
    return (
      <div className="panel table-state error" role="alert">
        {error}
        <button className="button secondary" onClick={() => void load()}>
          <RefreshCw size={15} />重试
        </button>
      </div>
    )
  }
  if (!selected) {
    return <div className="panel table-state">暂无运行记录，请先运行一个已发布 Agent 或工作流。</div>
  }

  return (
    <div className="run-layout">
      <section className="run-list panel">
        <div className="table-tools">
          <label className="field-search">
            <Search size={16} />
            <input
              aria-label="搜索运行记录"
              placeholder="搜索名称、ID 或状态"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button className="icon-button quiet" title="刷新运行记录" onClick={() => void load()}>
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="run-list-head"><span>持久化运行记录</span><strong>{filteredRuns.length} 个实例</strong></div>
        {filteredRuns.map((run) => (
          <button
            key={run.id}
            onClick={() => setSelectedId(run.id)}
            className={`run-list-item ${selectedId === run.id ? 'selected' : ''}`}
          >
            <div><strong>{run.name}</strong><span className="mono">{run.id}</span></div>
            <StatusBadge status={run.status} />
            <div className="run-progress"><i style={{ width: '100%' }} /></div>
            <small>{formatTime(run.startedAt)} · {formatDuration(run.durationMs)}</small>
          </button>
        ))}
      </section>

      <section className="run-detail panel">
        <header className="run-detail-header">
          <div>
            <span className="mono">{selected.id}</span>
            <h2>{selected.name}</h2>
            <p>{formatTime(selected.startedAt)} 启动 · {selected.kind === 'agent' ? 'Agent 测试运行' : `工作流 ${selected.workflowVersion}`}</p>
          </div>
          <div className="run-actions"><StatusBadge status={selected.status} /></div>
        </header>

        <div className="run-kpis">
          <div><span>总耗时</span><strong>{formatDuration(selected.durationMs)}</strong></div>
          <div><span>Token</span><strong>{selected.totalTokens}</strong></div>
          <div><span>质量得分</span><strong>{selected.score ?? '待评估'}</strong></div>
          <div><span>模型成本</span><strong>${selected.costUsd.toFixed(6)}</strong></div>
        </div>

        <div className="review-section">
          <div className="review-section-title"><h3>最终产出</h3><span>{selected.model || '未记录模型'}</span></div>
          <div className="artifact-preview"><p>{selected.output || selected.error || '本次运行没有产出内容。'}</p></div>
        </div>

        <div className="timeline">
          <h3>节点执行时间线</h3>
          {selected.nodes.map((node) => <TimelineItem node={node} key={node.id} />)}
        </div>
      </section>
    </div>
  )
}

function TimelineItem({ node }: { node: NodeExecution }) {
  const state = node.status === '失败' ? 'idle' : node.status === '运行中' ? 'running' : 'success'
  const detail = node.output || node.error || node.input
  return (
    <div className={`timeline-item ${state}`}>
      <div className="timeline-marker"><Play size={14} /></div>
      <div><strong>{node.nodeName}</strong><span>{detail}</span></div>
      <small>{node.status} · {formatDuration(node.durationMs)} · 尝试 {node.attempts} 次</small>
      {node.score !== null && <b>{node.score} 分</b>}
    </div>
  )
}
