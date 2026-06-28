import { Pencil, Play, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../auth/workspaceContextState'
import {
  batchResumeRunsFromFailedNode,
  batchRerunWorkflowRuns,
  listRunOperationHistory,
  listRuns,
  rerunWorkflowRun,
  resumeRunFromFailedNode,
} from '../api/execution'
import { StatusBadge } from '../components/StatusBadge'
import { displayStatus, isWaitingForHumanReview } from '../domain/statusText'
import type { ExecutionRun, NodeExecution, RunOperationHistoryEvent } from '../types'

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(2)} s`
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

const rerunnableWorkflowStatuses = new Set(['\u6fb6\u8fab\u89e6', '\u5931\u8d25', '\u5df2\u53d6\u6d88', '\u6062\u590d\u5931\u8d25'])
const failedWorkflowStatuses = new Set(['\u6fb6\u8fab\u89e6', '\u5931\u8d25'])
const runOperationActionLabels: Record<string, string> = {
  'run.rerun': '\u91cd\u65b0\u8fd0\u884c',
  'run.batch_rerun': '\u6279\u91cf\u91cd\u8dd1',
  'run.resume_failed_node': '\u5931\u8d25\u70b9\u6062\u590d',
  'run.batch_resume_failed_node': '\u6279\u91cf\u6062\u590d',
}
const operationMetadataKeys = [
  'sourceRunId',
  'newRunId',
  'runId',
  'failedNodeId',
  'failedNodeRunId',
  'workflowVersion',
  'batchSize',
  'inputOverridden',
]

type RunOperationFailure = {
  sourceRunId: string
  reason: string
}

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

function formatOperationMetadata(event: RunOperationHistoryEvent) {
  return operationMetadataKeys
    .filter((key) => event.metadata[key] !== undefined && event.metadata[key] !== null)
    .map((key) => `${key}: ${String(event.metadata[key])}`)
}

export function Runs() {
  const { workspace, workspacePath } = useWorkspace()
  const [runs, setRuns] = useState<ExecutionRun[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [rerunError, setRerunError] = useState('')
  const [rerunMessage, setRerunMessage] = useState('')
  const [operationFailures, setOperationFailures] = useState<RunOperationFailure[]>([])
  const [operationHistory, setOperationHistory] = useState<RunOperationHistoryEvent[]>([])
  const [operationHistoryError, setOperationHistoryError] = useState('')
  const [isOperationHistoryLoading, setIsOperationHistoryLoading] = useState(false)
  const [operationHistoryVersion, setOperationHistoryVersion] = useState(0)
  const [rerunningId, setRerunningId] = useState('')
  const [batchRerunning, setBatchRerunning] = useState(false)
  const [batchResuming, setBatchResuming] = useState(false)
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [editingRerunId, setEditingRerunId] = useState('')
  const [rerunInput, setRerunInput] = useState('')
  const [resumingId, setResumingId] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError('')
    setOperationFailures([])
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
  const selectedRerunnableRunIds = selectedRunIds.filter((runId) => {
    const run = runs.find((item) => item.id === runId)
    return run ? canRerunWorkflow(run) : false
  })
  const selectedResumableRunIds = selectedRunIds.filter((runId) => {
    const run = runs.find((item) => item.id === runId)
    return run ? canResumeFailedNode(run) : false
  })

  useEffect(() => {
    setEditingRerunId('')
    setRerunInput('')
  }, [selectedId])

  useEffect(() => {
    setSelectedRunIds((current) => current.filter((runId) => runs.some((run) => run.id === runId)))
  }, [runs])

  useEffect(() => {
    if (!selected?.id) {
      setOperationHistory([])
      setOperationHistoryError('')
      return
    }

    let isActive = true
    setIsOperationHistoryLoading(true)
    setOperationHistoryError('')
    void listRunOperationHistory(workspace.id, selected.id)
      .then((events) => {
        if (isActive) setOperationHistory(events)
      })
      .catch((historyError) => {
        if (!isActive) return
        setOperationHistory([])
        setOperationHistoryError(
          historyError instanceof Error ? historyError.message : '\u64cd\u4f5c\u5386\u53f2\u52a0\u8f7d\u5931\u8d25',
        )
      })
      .finally(() => {
        if (isActive) setIsOperationHistoryLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [operationHistoryVersion, selected?.id, workspace.id])

  const openRerunInputEditor = useCallback((run: ExecutionRun) => {
    setRerunError('')
    setRerunMessage('')
    setOperationFailures([])
    setEditingRerunId(run.id)
    setRerunInput(run.input)
  }, [])

  const handleRerun = useCallback(async (run: ExecutionRun, overriddenInput?: string) => {
    const trimmedInput = overriddenInput?.trim()
    if (overriddenInput !== undefined && !trimmedInput) {
      setRerunError('\u91cd\u8dd1\u8f93\u5165\u4e0d\u80fd\u4e3a\u7a7a')
      return
    }
    setRerunError('')
    setRerunMessage('')
    setOperationFailures([])
    setRerunningId(run.id)
    try {
      const rerun = await rerunWorkflowRun(
        workspace.id,
        run.id,
        trimmedInput === undefined ? undefined : { input: trimmedInput },
      )
      setRuns((currentRuns) => [
        rerun,
        ...currentRuns.filter((currentRun) => currentRun.id !== rerun.id),
      ])
      setSelectedId(rerun.id)
      setEditingRerunId('')
      setRerunInput('')
      setRerunMessage('\u91cd\u65b0\u8fd0\u884c\u5df2\u521b\u5efa')
      setOperationHistoryVersion((current) => current + 1)
    } catch (rerunRequestError) {
      setRerunError(rerunRequestError instanceof Error ? rerunRequestError.message : '\u91cd\u65b0\u8fd0\u884c\u5931\u8d25')
    } finally {
      setRerunningId('')
    }
  }, [workspace.id])

  const toggleSelectedRun = useCallback((run: ExecutionRun, checked: boolean) => {
    setSelectedRunIds((current) => {
      if (checked) return current.includes(run.id) ? current : [...current, run.id]
      return current.filter((runId) => runId !== run.id)
    })
  }, [])

  const handleBatchRerun = useCallback(async () => {
    if (selectedRerunnableRunIds.length === 0) {
      setRerunError('请先选择可重跑的工作流运行')
      return
    }
    setRerunError('')
    setRerunMessage('')
    setOperationFailures([])
    setBatchRerunning(true)
    try {
      const result = await batchRerunWorkflowRuns(workspace.id, selectedRerunnableRunIds)
      setRuns((currentRuns) => [
        ...result.createdRuns,
        ...currentRuns.filter((currentRun) => !result.createdRuns.some((createdRun) => createdRun.id === currentRun.id)),
      ])
      if (result.createdRuns[0]) {
        setSelectedId(result.createdRuns[0].id)
      }
      setSelectedRunIds([])
      setOperationFailures(result.failures)
      setOperationHistoryVersion((current) => current + 1)
      setRerunMessage(
        result.failures.length > 0
          ? `已批量重跑 ${result.createdRuns.length} 条，${result.failures.length} 条失败`
          : `已批量重跑 ${result.createdRuns.length} 条`,
      )
    } catch (batchRerunError) {
      setRerunError(batchRerunError instanceof Error ? batchRerunError.message : '批量重跑失败')
    } finally {
      setBatchRerunning(false)
    }
  }, [selectedRerunnableRunIds, workspace.id])

  const handleBatchResumeFromFailedNode = useCallback(async () => {
    if (selectedResumableRunIds.length === 0) {
      setRerunError('\u8bf7\u5148\u9009\u62e9\u53ef\u6062\u590d\u7684\u5931\u8d25\u5de5\u4f5c\u6d41\u8fd0\u884c')
      return
    }
    setRerunError('')
    setRerunMessage('')
    setOperationFailures([])
    setBatchResuming(true)
    try {
      const result = await batchResumeRunsFromFailedNode(workspace.id, selectedResumableRunIds)
      setRuns((currentRuns) => currentRuns.map((currentRun) => (
        result.resumedRuns.find((resumedRun) => resumedRun.id === currentRun.id) ?? currentRun
      )))
      if (result.resumedRuns[0]) {
        setSelectedId(result.resumedRuns[0].id)
      }
      setSelectedRunIds([])
      setOperationFailures(result.failures)
      setOperationHistoryVersion((current) => current + 1)
      setRerunMessage(
        result.failures.length > 0
          ? `\u5df2\u6279\u91cf\u6062\u590d ${result.resumedRuns.length} \u6761\uff0c${result.failures.length} \u6761\u5931\u8d25`
          : `\u5df2\u6279\u91cf\u6062\u590d ${result.resumedRuns.length} \u6761`,
      )
    } catch (batchResumeError) {
      setRerunError(batchResumeError instanceof Error ? batchResumeError.message : '\u6279\u91cf\u6062\u590d\u5931\u8d25')
    } finally {
      setBatchResuming(false)
    }
  }, [selectedResumableRunIds, workspace.id])

  const handleResumeFromFailedNode = useCallback(async (run: ExecutionRun) => {
    setRerunError('')
    setRerunMessage('')
    setOperationFailures([])
    setResumingId(run.id)
    try {
      const resumed = await resumeRunFromFailedNode(workspace.id, run.id)
      setRuns((currentRuns) => currentRuns.map((currentRun) => (
        currentRun.id === resumed.id ? resumed : currentRun
      )))
      setSelectedId(resumed.id)
      setRerunMessage('\u5df2\u4ece\u5931\u8d25\u70b9\u6062\u590d')
      setOperationHistoryVersion((current) => current + 1)
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
        {(selectedRerunnableRunIds.length > 0 || selectedResumableRunIds.length > 0) && (
          <div className="run-batch-bar">
            <span>{'\u5df2\u9009\u62e9'} {selectedRunIds.length} {'\u6761'}</span>
            {selectedRerunnableRunIds.length > 0 && (
              <button
                className="button secondary compact"
                disabled={batchRerunning || batchResuming}
                onClick={() => void handleBatchRerun()}
              >
                <RotateCcw size={15} />
                {batchRerunning ? '\u6279\u91cf\u91cd\u8dd1\u4e2d' : '\u6279\u91cf\u91cd\u8dd1'}
              </button>
            )}
            {selectedResumableRunIds.length > 0 && (
              <button
                className="button secondary compact"
                disabled={batchRerunning || batchResuming}
                onClick={() => void handleBatchResumeFromFailedNode()}
              >
                <Play size={15} />
                {batchResuming ? '\u6279\u91cf\u6062\u590d\u4e2d' : '\u6279\u91cf\u6062\u590d'}
              </button>
            )}
            <button className="button secondary compact" onClick={() => setSelectedRunIds([])}>
              {'\u6e05\u7a7a'}
            </button>
          </div>
        )}
        {filteredRuns.map((run) => (
          <div className="run-list-row" key={run.id}>
            {canRerunWorkflow(run) && (
              <input
                aria-label={`选择运行 ${run.id}`}
                checked={selectedRunIds.includes(run.id)}
                className="run-select-checkbox"
                type="checkbox"
                onChange={(event) => toggleSelectedRun(run, event.target.checked)}
              />
            )}
            <button
              onClick={() => setSelectedId(run.id)}
              className={`run-list-item ${selectedId === run.id ? 'selected' : ''}`}
            >
              <div><strong>{run.name}</strong><span className="mono">{run.id}</span></div>
              <StatusBadge status={run.status} />
              <div className="run-progress"><i style={{ width: '100%' }} /></div>
              <small>{formatTime(run.startedAt)} · {formatDuration(run.durationMs)}</small>
            </button>
          </div>
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
              <>
                <button
                  className="button secondary compact"
                  disabled={rerunningId === selected.id}
                  onClick={() => void handleRerun(selected)}
                >
                  <RotateCcw size={15} />
                  {rerunningId === selected.id ? '\u91cd\u65b0\u8fd0\u884c\u4e2d' : '\u91cd\u65b0\u8fd0\u884c'}
                </button>
                <button
                  className="button secondary compact"
                  disabled={rerunningId === selected.id}
                  onClick={() => openRerunInputEditor(selected)}
                >
                  <Pencil size={15} />
                  {'\u7f16\u8f91\u8f93\u5165\u91cd\u8dd1'}
                </button>
              </>
            )}
            <StatusBadge status={selected.status} />
          </div>
        </header>

        {rerunMessage && <div className="run-action-notice success">{rerunMessage}</div>}
        {rerunError && <div className="run-action-notice error" role="alert">{rerunError}</div>}
        {operationFailures.length > 0 && (
          <div className="run-operation-failures" role="status">
            <header>
              <strong>{'\u672a\u5b8c\u6210\u7684\u6279\u91cf\u9879'}</strong>
              <span>{operationFailures.length} {'\u6761\u9700\u8981\u5904\u7406'}</span>
            </header>
            <ul>
              {operationFailures.map((failure) => (
                <li key={`${failure.sourceRunId}-${failure.reason}`}>
                  <span className="mono">{failure.sourceRunId}</span>
                  <p>{failure.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {editingRerunId === selected.id && (
          <div className="run-rerun-editor">
            <label>
              <span>{'\u91cd\u8dd1\u8f93\u5165'}</span>
              <textarea
                aria-label={'\u91cd\u8dd1\u8f93\u5165'}
                value={rerunInput}
                onChange={(event) => setRerunInput(event.target.value)}
              />
            </label>
            <div className="run-rerun-editor-actions">
              <button className="button secondary compact" onClick={() => setEditingRerunId('')}>
                {'\u53d6\u6d88'}
              </button>
              <button
                className="button primary compact"
                disabled={rerunningId === selected.id}
                onClick={() => void handleRerun(selected, rerunInput)}
              >
                <RotateCcw size={15} />
                {rerunningId === selected.id ? '\u91cd\u65b0\u8fd0\u884c\u4e2d' : '\u786e\u8ba4\u91cd\u8dd1'}
              </button>
            </div>
          </div>
        )}

        <div className="run-kpis">
          <div><span>总耗时</span><strong>{formatDuration(selected.durationMs)}</strong></div>
          <div><span>Token</span><strong>{selected.totalTokens}</strong></div>
          <div><span>质量得分</span><strong>{selected.score ?? '待评估'}</strong></div>
          <div><span>模型成本</span><strong>${selected.costUsd.toFixed(6)}</strong></div>
        </div>

        <div className="run-operation-history">
          <div className="review-section-title">
            <h3>{'\u64cd\u4f5c\u5386\u53f2'}</h3>
            <span>{operationHistory.length} {'\u6761'}</span>
          </div>
          {isOperationHistoryLoading && (
            <div className="run-operation-history-state">{'\u6b63\u5728\u52a0\u8f7d\u64cd\u4f5c\u5386\u53f2'}</div>
          )}
          {operationHistoryError && (
            <div className="run-operation-history-state error" role="alert">{operationHistoryError}</div>
          )}
          {!isOperationHistoryLoading && !operationHistoryError && operationHistory.length === 0 && (
            <div className="run-operation-history-state">{'\u6682\u65e0\u64cd\u4f5c\u8bb0\u5f55'}</div>
          )}
          <div className="run-operation-history-list">
            {operationHistory.map((event) => {
              const metadataLines = formatOperationMetadata(event)
              return (
                <article className="run-operation-history-item" key={event.id}>
                  <div>
                    <strong>{runOperationActionLabels[event.action] ?? event.action}</strong>
                    <span>{formatTime(event.createdAt)}</span>
                  </div>
                  <div className="run-operation-history-meta">
                    {event.requestId && <span className="mono">{event.requestId}</span>}
                    {event.outcome && <span>{event.outcome}</span>}
                    {event.reason && <span>{event.reason}</span>}
                  </div>
                  {metadataLines.length > 0 && (
                    <ul>
                      {metadataLines.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  )}
                </article>
              )
            })}
          </div>
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
