import { Play, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../auth/workspaceContextState'
import { listRuns, rerunWorkflowRun, resumeRunFromFailedNode } from '../api/execution'
import { StatusBadge } from '../components/StatusBadge'
import { displayStatus, isWaitingForHumanReview } from '../domain/statusText'
import type { ExecutionRun, NodeExecution } from '../types'

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(2)} s`
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

const rerunnableWorkflowStatuses = new Set(['\u6fb6\u8fab\u89e6', '\u5931\u8d25', '\u5df2\u53d6\u6d88', '\u6062\u590d\u5931\u8d25'])
const failedWorkflowStatuses = new Set(['\u6fb6\u8fab\u89e6', '\u5931\u8d25'])

function canRerunWorkflow(run: ExecutionRun) {
  const status = displayStatus(run.status)
  return (
    run.kind === 'workflow'
    && Boolean(run.workflowId)
    && Boolean(run.workflowVersion)
    && (rerunnableWorkflowStatuses.has(status) || (status === '??' && Boolean(run.error)))
  )
}

function canResumeFailedNode(run: ExecutionRun) {
  const status = displayStatus(run.status)
  return (
    run.kind === 'workflow'
    && Boolean(run.workflowId)
    && Boolean(run.workflowVersion)
    && (failedWorkflowStatuses.has(status) || (status === '??' && Boolean(run.error)))
  )
}

export function Runs() {
  const { workspace, workspacePath } = useWorkspace()
  const [runs, setRuns] = useState<ExecutionRun[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [rerunError, setRerunError] = useState('')
  const [rerunMessage, setRerunMessage] = useState('')
  const [rerunningId, setRerunningId] = useState('')
  const [resumingId, setResumingId] = useState('')
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

  const handleRerun = useCallback(async (run: ExecutionRun) => {
    setRerunError('')
    setRerunMessage('')
    setRerunningId(run.id)
    try {
      const rerun = await rerunWorkflowRun(workspace.id, run.id)
      setRuns((currentRuns) => [
        rerun,
        ...currentRuns.filter((currentRun) => currentRun.id !== rerun.id),
      ])
      setSelectedId(rerun.id)
      setRerunMessage('\u91cd\u65b0\u8fd0\u884c\u5df2\u521b\u5efa')
    } catch (rerunRequestError) {
      setRerunError(rerunRequestError instanceof Error ? rerunRequestError.message : '\u91cd\u65b0\u8fd0\u884c\u5931\u8d25')
    } finally {
      setRerunningId('')
    }
  }, [workspace.id])

  const handleResumeFromFailedNode = useCallback(async (run: ExecutionRun) => {
    setRerunError('')
    setRerunMessage('')
    setResumingId(run.id)
    try {
      const resumed = await resumeRunFromFailedNode(workspace.id, run.id)
      setRuns((currentRuns) => currentRuns.map((currentRun) => (
        currentRun.id === resumed.id ? resumed : currentRun
      )))
      setSelectedId(resumed.id)
      setRerunMessage('\u5df2\u4ece\u5931\u8d25\u70b9\u6062\u590d')
    } catch (resumeRequestError) {
      setRerunError(resumeRequestError instanceof Error ? resumeRequestError.message : '\u5931\u8d25\u70b9\u6062\u590d\u5931\u8d25')
    } finally {
      setResumingId('')
    }
  }, [workspace.id])

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
          <div className="run-actions">
            {canResumeFailedNode(selected) && (
              <button
                className="button secondary compact"
                disabled={resumingId === selected.id}
                onClick={() => void handleResumeFromFailedNode(selected)}
              >
                <Play size={15} />
                {resumingId === selected.id ? '\u6062\u590d\u4e2d' : '\u4ece\u5931\u8d25\u70b9\u6062\u590d'}
              </button>
            )}
            {canRerunWorkflow(selected) && (
              <button
                className="button secondary compact"
                disabled={rerunningId === selected.id}
                onClick={() => void handleRerun(selected)}
              >
                <RotateCcw size={15} />
                {rerunningId === selected.id ? '\u91cd\u65b0\u8fd0\u884c\u4e2d' : '\u91cd\u65b0\u8fd0\u884c'}
              </button>
            )}
            <StatusBadge status={selected.status} />
          </div>
        </header>

        {rerunMessage && <div className="run-action-notice success">{rerunMessage}</div>}
        {rerunError && <div className="run-action-notice error" role="alert">{rerunError}</div>}

        <div className="run-kpis">
          <div><span>总耗时</span><strong>{formatDuration(selected.durationMs)}</strong></div>
          <div><span>Token</span><strong>{selected.totalTokens}</strong></div>
          <div><span>质量得分</span><strong>{selected.score ?? '待评估'}</strong></div>
          <div><span>模型成本</span><strong>${selected.costUsd.toFixed(6)}</strong></div>
        </div>

        {isWaitingForHumanReview(selected.status) && (
          <div className="review-handoff-notice run-review-notice">
            <div>
              <strong>等待人工审核</strong>
              <span>当前运行停在 {selected.currentNode || '人工审核节点'}。处理对应 Human Task 后，运行状态会继续更新。</span>
            </div>
            <a className="button primary" href={workspacePath('reviews')}>去人工审核处理</a>
          </div>
        )}

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
