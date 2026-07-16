import { Play, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../auth/workspaceContextState'
import { listArtifacts } from '../api/artifacts'
import { deleteRun, listRuns } from '../api/execution'
import { listWorkflowVersions } from '../api/workflows'
import { StatusBadge } from '../components/StatusBadge'
import { displayStatus, isWaitingForHumanReview } from '../domain/statusText'
import type {
  ArtifactCatalogItem,
  ExecutionRun,
  NodeExecution,
  WorkflowEvaluationResult,
  WorkflowNodeContract,
  WorkflowVersion,
} from '../types'

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(2)} s`
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

function runGraphVisualStatus(statusValue: string) {
  const status = displayStatus(statusValue)
  if (status === '失败' || status === '恢复失败') return 'error'
  if (status === '需介入' || status === '等待审核' || status === '待认领' || status === '审核中') return 'warning'
  if (status === '运行中' || status === '排队中') return 'running'
  if (status === '已完成' || status === '已通过' || status === '修改后通过') return 'success'
  return 'idle'
}

function runGraphVisualLabel(statusValue: string) {
  const status = displayStatus(statusValue)
  if (status === '失败' || status === '恢复失败') return '报错'
  if (status === '需介入' || status === '等待审核' || status === '待认领' || status === '审核中') return '等待'
  if (status === '运行中' || status === '排队中') return '运行中'
  if (status === '已完成' || status === '已通过' || status === '修改后通过') return '通过'
  return status
}

interface RunGraphNode {
  id: string
  nodeId: string
  nodeType: string
  nodeName: string
  status: string
  durationMs: number
  attempts: number | null
  score: number | null
  executed: boolean
}

function workflowNodeLabel(node: WorkflowNodeContract) {
  const label = node.data.label
  return typeof label === 'string' && label.trim() ? label.trim() : node.id
}

function workflowNodeKind(node: WorkflowNodeContract) {
  const kind = node.data.kind
  if (typeof kind === 'string' && kind.trim()) return kind.trim()
  return node.type || 'node'
}

function sortWorkflowNodesByGraph(snapshot: WorkflowVersion['snapshot']) {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const incomingCount = new Map(snapshot.nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>()

  snapshot.edges.forEach((edge) => {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) return
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  })

  const queue = snapshot.nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y)
    .map((node) => node.id)
  const ordered: WorkflowNodeContract[] = []
  const visited = new Set<string>()

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (visited.has(nodeId)) continue
    const node = nodesById.get(nodeId)
    if (!node) continue
    visited.add(nodeId)
    ordered.push(node)

    for (const targetId of outgoing.get(nodeId) ?? []) {
      incomingCount.set(targetId, Math.max(0, (incomingCount.get(targetId) ?? 0) - 1))
      if ((incomingCount.get(targetId) ?? 0) === 0) queue.push(targetId)
    }
  }

  const remaining = snapshot.nodes
    .filter((node) => !visited.has(node.id))
    .sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y)
  return [...ordered, ...remaining]
}

function buildRunGraphNodes(run: ExecutionRun, workflowVersion: WorkflowVersion | null): RunGraphNode[] {
  const runByNodeId = new Map(run.nodes.map((node) => [node.nodeId, node]))
  if (!workflowVersion) {
    return run.nodes.map((node) => ({
      id: node.id,
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      nodeName: node.nodeName,
      status: node.status,
      durationMs: node.durationMs,
      attempts: node.attempts,
      score: node.score,
      executed: true,
    }))
  }

  return sortWorkflowNodesByGraph(workflowVersion.snapshot).map((workflowNode) => {
    const runNode = runByNodeId.get(workflowNode.id)
    if (runNode) {
      return {
        id: runNode.id,
        nodeId: runNode.nodeId,
        nodeType: runNode.nodeType,
        nodeName: runNode.nodeName,
        status: runNode.status,
        durationMs: runNode.durationMs,
        attempts: runNode.attempts,
        score: runNode.score,
        executed: true,
      }
    }
    return {
      id: `pending-${workflowNode.id}`,
      nodeId: workflowNode.id,
      nodeType: workflowNodeKind(workflowNode),
      nodeName: workflowNodeLabel(workflowNode),
      status: '未开始',
      durationMs: 0,
      attempts: null,
      score: null,
      executed: false,
    }
  })
}

function requestedRunIdFromLocation() {
  return new URLSearchParams(window.location.search).get('runId') ?? ''
}

function syncRunIdToLocation(runId: string) {
  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.set('runId', runId)
  window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`)
}

function clearRunIdFromLocation() {
  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.delete('runId')
  window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`)
}

function artifactPreview(content: string) {
  const normalized = content.trim().replace(/\s+/g, ' ')
  if (!normalized) return '空产出物'
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseWorkflowEvaluationResult(output: string): WorkflowEvaluationResult | null {
  if (!output.trim()) return null
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    return null
  }
  if (!isUnknownRecord(value)) return null
  if (!isNonEmptyString(value.evaluationRecordId)
    || !isNonEmptyString(value.templateId)
    || !isNonEmptyString(value.templateVersion)
    || !isNonEmptyString(value.modelProviderName)
    || !isFiniteNumber(value.totalScore)
    || typeof value.passed !== 'boolean'
    || !isNonEmptyString(value.overallReason)
    || !Array.isArray(value.dimensions)
    || value.dimensions.length === 0
  ) {
    return null
  }

  const dimensions: WorkflowEvaluationResult['dimensions'] = []
  for (const dimension of value.dimensions) {
    if (!isUnknownRecord(dimension)
      || !isNonEmptyString(dimension.dimensionId)
      || !isNonEmptyString(dimension.dimensionName)
      || !isFiniteNumber(dimension.score)
      || !isFiniteNumber(dimension.weight)
      || !isFiniteNumber(dimension.weightedScore)
      || !isNonEmptyString(dimension.reason)
    ) {
      return null
    }
    dimensions.push({
      dimensionId: dimension.dimensionId,
      dimensionName: dimension.dimensionName,
      score: dimension.score,
      weight: dimension.weight,
      weightedScore: dimension.weightedScore,
      reason: dimension.reason,
    })
  }

  return {
    evaluationRecordId: value.evaluationRecordId,
    templateId: value.templateId,
    templateVersion: value.templateVersion,
    ...(isNonEmptyString(value.modelProviderId) ? { modelProviderId: value.modelProviderId } : {}),
    modelProviderName: value.modelProviderName,
    ...(isNonEmptyString(value.model) ? { model: value.model } : {}),
    totalScore: value.totalScore,
    passed: value.passed,
    overallReason: value.overallReason,
    dimensions,
  }
}

function evaluationTemplateName(
  node: NodeExecution,
  workflowVersion: WorkflowVersion | null,
  result: WorkflowEvaluationResult,
) {
  const workflowNode = workflowVersion?.snapshot.nodes.find((item) => item.id === node.nodeId)
  const rubricRef = workflowNode?.data.rubricRef
  if (isUnknownRecord(rubricRef) && isNonEmptyString(rubricRef.name)) {
    return rubricRef.name
  }
  return result.templateId
}

export function Runs() {
  const { workspace, workspacePath } = useWorkspace()
  const [runs, setRuns] = useState<ExecutionRun[]>([])
  const [selectedId, setSelectedId] = useState(() => requestedRunIdFromLocation())
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [error, setError] = useState('')
  const [runArtifacts, setRunArtifacts] = useState<ArtifactCatalogItem[]>([])
  const [artifactError, setArtifactError] = useState('')
  const [isArtifactsLoading, setIsArtifactsLoading] = useState(false)
  const [selectedWorkflowVersion, setSelectedWorkflowVersion] = useState<WorkflowVersion | null>(null)
  const [resolvedWorkflowVersionKey, setResolvedWorkflowVersionKey] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [deleteCandidate, setDeleteCandidate] = useState<ExecutionRun | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const nextRuns = await listRuns(workspace.id)
      setRuns(nextRuns)
      setSelectedId((current) => (
        nextRuns.some((run) => run.id === current)
          ? current
          : nextRuns.find((run) => run.id === requestedRunIdFromLocation())?.id ?? nextRuns[0]?.id ?? ''
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

  const statusOptions = useMemo(() => (
    Array.from(new Set(runs.map((run) => displayStatus(run.status))))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))
  ), [runs])
  const filteredRuns = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const normalizedStatus = statusFilter.trim()
    return runs.filter((run) => (
      (!normalizedStatus || displayStatus(run.status) === normalizedStatus)
      && (
        !keyword
        || run.name.toLowerCase().includes(keyword)
        || run.id.toLowerCase().includes(keyword)
        || displayStatus(run.status).toLowerCase().includes(keyword)
        || run.status.toLowerCase().includes(keyword)
      )
    ))
  }, [query, runs, statusFilter])

  useEffect(() => {
    if (!statusFilter || filteredRuns.length === 0 || filteredRuns.some((run) => run.id === selectedId)) return
    setSelectedId(filteredRuns[0].id)
    syncRunIdToLocation(filteredRuns[0].id)
  }, [filteredRuns, selectedId, statusFilter])

  const handleDeleteRun = async () => {
    if (!deleteCandidate) return
    setIsDeleting(true)
    setDeleteError('')
    try {
      await deleteRun(workspace.id, deleteCandidate.id)
      const nextRuns = runs.filter((run) => run.id !== deleteCandidate.id)
      setRuns(nextRuns)
      if (selectedId === deleteCandidate.id) {
        const nextSelectedId = nextRuns[0]?.id ?? ''
        setSelectedId(nextSelectedId)
        if (nextSelectedId) syncRunIdToLocation(nextSelectedId)
        else clearRunIdFromLocation()
      }
      setDeleteCandidate(null)
    } catch (runDeleteError) {
      setDeleteError(runDeleteError instanceof Error ? runDeleteError.message : '删除运行记录失败')
    } finally {
      setIsDeleting(false)
    }
  }

  const selected = runs.find((run) => run.id === selectedId) ?? runs[0]
  const runGraphNodes = useMemo(
    () => (selected ? buildRunGraphNodes(selected, selectedWorkflowVersion) : []),
    [selected, selectedWorkflowVersion],
  )
  const selectedWorkflowVersionKey = selected?.workflowId && selected.workflowVersion
    ? `${selected.workflowId}|${selected.workflowVersion}`
    : ''
  const evaluationNodeResults = useMemo(() => (
    selected?.nodes
      .filter((node) => node.nodeType === 'evaluation')
      .map((node) => ({ node, result: parseWorkflowEvaluationResult(node.output) })) ?? []
  ), [selected])
  const evaluationDetailsReady = !selectedWorkflowVersionKey
    || resolvedWorkflowVersionKey === selectedWorkflowVersionKey
  const selectedOutputEvaluation = selected
    ? parseWorkflowEvaluationResult(selected.output)
    : null
  const displayedRunOutput = selectedOutputEvaluation?.overallReason
    ?? (evaluationNodeResults.length > 0 && selected?.output
      ? '评估结果格式无效，详情见评估节点。'
      : selected?.output || selected?.error || '本次运行没有产出内容。')
  const artifactsByNodeRunId = useMemo(() => {
    const grouped = new Map<string, ArtifactCatalogItem[]>()
    runArtifacts.forEach((artifact) => {
      grouped.set(artifact.sourceNodeRunId, [...(grouped.get(artifact.sourceNodeRunId) ?? []), artifact])
    })
    return grouped
  }, [runArtifacts])
  const artifactNodeRows = useMemo(() => {
    if (!selected) return []
    if (runGraphNodes.length > 0) return runGraphNodes
    return selected.nodes.map((node) => ({
      id: node.id,
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      nodeName: node.nodeName,
      status: node.status,
      durationMs: node.durationMs,
      attempts: node.attempts,
      score: node.score,
      executed: true,
    }))
  }, [runGraphNodes, selected])

  useEffect(() => {
    if (!selected?.workflowId || !selected.workflowVersion) {
      setSelectedWorkflowVersion(null)
      setResolvedWorkflowVersionKey('')
      return
    }

    let isActive = true
    setSelectedWorkflowVersion(null)
    setResolvedWorkflowVersionKey('')
    void listWorkflowVersions(workspace.id, selected.workflowId)
      .then((versions) => {
        if (!isActive) return
        setSelectedWorkflowVersion(
          versions.find((version) => version.version === selected.workflowVersion) ?? null,
        )
      })
      .catch(() => {
        if (isActive) setSelectedWorkflowVersion(null)
      })
      .finally(() => {
        if (isActive) setResolvedWorkflowVersionKey(selectedWorkflowVersionKey)
      })

    return () => {
      isActive = false
    }
  }, [selected?.workflowId, selected?.workflowVersion, selectedWorkflowVersionKey, workspace.id])

  useEffect(() => {
    if (!selected?.id) {
      setRunArtifacts([])
      setArtifactError('')
      return
    }

    let isActive = true
    setRunArtifacts([])
    setArtifactError('')
    setIsArtifactsLoading(true)
    void listArtifacts(workspace.id, { runId: selected.id })
      .then((artifacts) => {
        if (isActive) setRunArtifacts(artifacts)
      })
      .catch((artifactsError) => {
        if (!isActive) return
        setRunArtifacts([])
        setArtifactError(artifactsError instanceof Error ? artifactsError.message : '节点产出物加载失败')
      })
      .finally(() => {
        if (isActive) setIsArtifactsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [selected?.id, workspace.id])

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
          <label className="run-status-filter">
            <span>流程状态</span>
            <select
              aria-label="流程状态筛选"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">全部状态</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <button className="icon-button quiet" title="刷新运行记录" onClick={() => void load()}>
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="run-list-head"><span>持久化运行记录</span><strong>{filteredRuns.length} 个实例</strong></div>
        <div className="run-list-scroll">
        {filteredRuns.map((run) => (
          <div className="run-list-row" key={run.id}>
            <button
              onClick={() => {
                setSelectedId(run.id)
                syncRunIdToLocation(run.id)
              }}
              className={`run-list-item ${selectedId === run.id ? 'selected' : ''}`}
            >
              <div>
                <strong>{run.name}</strong>
                <span><b>启动</b>{formatTime(run.startedAt)}</span>
                <span><b>耗时</b>{formatDuration(run.durationMs)}</span>
              </div>
              <StatusBadge status={run.status} />
              <div className="run-progress"><i style={{ width: '100%' }} /></div>
            </button>
              <button
                type="button"
                className="icon-button quiet run-delete-button"
                aria-label="Delete run record"
              title="删除运行记录"
              onClick={() => {
                setDeleteCandidate(run)
                setDeleteError('')
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {filteredRuns.length === 0 && <div className="table-state compact">当前筛选没有运行记录</div>}
        </div>
      </section>

      <section className="run-detail panel">
        <header className="run-detail-header">
          <div>
            <span className="mono">{selected.kind === 'agent' ? 'AGENT RUN' : 'WORKFLOW RUN'}</span>
            <h2>{selected.name}</h2>
            <p><b>启动</b>{formatTime(selected.startedAt)}<b>耗时</b>{formatDuration(selected.durationMs)}<b>{selected.kind === 'agent' ? '类型' : '版本'}</b>{selected.kind === 'agent' ? 'Agent 测试运行' : selected.workflowVersion}</p>
          </div>
          <div className="run-actions">
            <StatusBadge status={selected.status} />
          </div>
        </header>

        {selected.kind === 'workflow' && (
          <section className="run-graph-panel" aria-label="完整工作流链路">
            <div className="run-graph-header">
              <div>
                <span className="section-kicker">WORKFLOW RUN MAP</span>
                <h3>完整工作流链路</h3>
                <p>{runGraphNodes.length} 个节点 · 已执行 {selected.nodes.length} 个 · 当前节点：{selected.currentNode || '未记录'}</p>
              </div>
              <div className="workflow-runtime-legend" aria-label="节点运行状态图例">
                <span><i className="success" />通过</span>
                <span><i className="warning" />等待</span>
                <span><i className="error" />报错</span>
              </div>
            </div>
            {runGraphNodes.length === 0 ? (
              <div className="run-graph-empty">暂无节点运行记录。</div>
            ) : (
              <div className="run-graph-viewport">
                <div
                  className="run-graph-strip"
                  style={{ minWidth: `${Math.max(900, runGraphNodes.length * 340)}px` }}
                >
                  {runGraphNodes.map((node, index) => (
                    <div className="run-graph-step-wrap" key={node.id}>
                      <div
                        className={`run-graph-step ${runGraphVisualStatus(node.status)} ${node.nodeName === selected.currentNode ? 'current' : ''}`}
                      >
                        <span className="run-graph-index">{String(index + 1).padStart(2, '0')}</span>
                        <div className="run-graph-step-heading">
                          <small>{node.nodeType}</small>
                          <strong className="run-graph-node-title">{node.nodeName}</strong>
                        </div>
                        <span className="run-graph-status">{node.executed ? runGraphVisualLabel(node.status) : '未开始'}</span>
                        <dl>
                          <div><dt>耗时</dt><dd>{formatDuration(node.durationMs)}</dd></div>
                          <div><dt>尝试</dt><dd>{node.attempts === null ? '-' : `${node.attempts} 次`}</dd></div>
                          <div><dt>得分</dt><dd>{node.score ?? '待评估'}</dd></div>
                        </dl>
                      </div>
                      {index < runGraphNodes.length - 1 && <i aria-hidden="true" data-testid="run-graph-connector" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <div className="run-kpis">
          <div><span>总耗时</span><strong>{formatDuration(selected.durationMs)}</strong></div>
          <div><span>Token</span><strong>{selected.totalTokens}</strong></div>
          <div><span>质量得分</span><strong>{selected.score ?? '待评估'}</strong></div>
          <div><span>模型成本</span><strong>${selected.costUsd.toFixed(6)}</strong></div>
        </div>

        {evaluationDetailsReady && evaluationNodeResults.map(({ node, result }) => (
          result ? (
            <EvaluationResultPanel
              key={node.id}
              node={node}
              result={result}
              templateName={evaluationTemplateName(node, selectedWorkflowVersion, result)}
            />
          ) : node.error || node.status === '失败' ? (
            <div className="evaluation-result-error" role="alert" key={node.id}>
              <strong>评估执行失败</strong>
              <span>{node.error || `${node.nodeName} 执行失败，请查看运行日志后重试。`}</span>
            </div>
          ) : (
            <div className="evaluation-result-error" role="alert" key={node.id}>
              <strong>评估结果格式无效</strong>
              <span>{node.nodeName} 的结构化结果无法安全解析，请查看节点错误信息或重新运行。</span>
            </div>
          )
        ))}

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
          <div className="review-section-title"><h3>工作流最终产出</h3><span>{selected.model || '未记录模型'}</span></div>
          <div className="artifact-preview"><p>{displayedRunOutput}</p></div>
        </div>

        <section className="review-section run-artifact-section" aria-label="节点产出物">
          <div className="review-section-title">
            <h3>节点产出物</h3>
            <span>{runArtifacts.length} 个 Artifact</span>
          </div>
          {isArtifactsLoading && <div className="table-state compact">正在加载节点产出物…</div>}
          {artifactError && <div className="table-state error compact" role="alert">{artifactError}</div>}
          {!isArtifactsLoading && !artifactError && (
            <div className="run-artifact-node-list">
              {artifactNodeRows.map((node) => {
                const artifacts = artifactsByNodeRunId.get(node.id) ?? []
                return (
                  <article className="run-artifact-node" key={node.id}>
                    <header>
                      <div>
                        <span className="mono">{node.nodeType}</span>
                        <strong>{node.nodeName}</strong>
                      </div>
                      <StatusBadge status={node.executed ? node.status : '未开始'} />
                    </header>
                    {artifacts.length === 0 ? (
                      <div className="run-artifact-empty">无</div>
                    ) : (
                      <div className="run-artifact-list">
                        {artifacts.map((artifact) => (
                          <div className="run-artifact-card" key={artifact.artifactVersionId}>
                            <div>
                              <strong>v{artifact.version}</strong>
                              <span className="mono">{artifact.artifactVersionId}</span>
                            </div>
                            <p>{artifactPreview(artifact.content)}</p>
                            <footer>
                              <span>{artifact.schemaValidation?.label ?? '未校验 Schema'}</span>
                              <span>{artifact.score === null ? '待评估' : `${artifact.score} 分`}</span>
                            </footer>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <div className="timeline">
          <h3>节点执行时间线</h3>
          {selected.nodes.map((node) => <TimelineItem node={node} key={node.id} />)}
        </div>
      </section>

      {deleteCandidate && (
        <div className="dialog-backdrop">
          <section className="agent-dialog run-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="run-delete-title">
            <header>
              <div>
                <span className="eyebrow">DELETE RUN RECORD</span>
                <h2 id="run-delete-title">删除运行记录</h2>
              </div>
            </header>
            <div className="run-delete-dialog-body">
              <p>这只会删除运行中心里的这条运行实例，不会删除工作流编排里的工作流。</p>
              <strong>{deleteCandidate.name}</strong>
              {deleteError && <div className="table-state error compact" role="alert">{deleteError}</div>}
            </div>
            <footer className="run-delete-dialog-actions">
              <button className="button secondary" type="button" onClick={() => setDeleteCandidate(null)} disabled={isDeleting}>
                取消
              </button>
              <button className="button danger" type="button" onClick={() => void handleDeleteRun()} disabled={isDeleting}>
                {isDeleting ? '删除中...' : 'Confirm delete run record'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}

function EvaluationResultPanel({
  node,
  result,
  templateName,
}: {
  node: NodeExecution
  result: WorkflowEvaluationResult
  templateName: string
}) {
  const actualModel = result.model || node.model || '未记录模型'
  return (
    <section className="evaluation-result-panel" aria-label="评估结果">
      <header>
        <div>
          <span className="section-kicker">EVALUATION RESULT</span>
          <h3>{node.nodeName}</h3>
        </div>
        <span className={`evaluation-outcome ${result.passed ? 'passed' : 'not-passed'}`}>
          {result.passed ? '评估通过' : '评估未通过'}
        </span>
      </header>
      <div className="evaluation-result-overview">
        <div className="evaluation-total-score">
          <span>总分</span>
          <strong>{result.totalScore}</strong>
        </div>
        <p>{result.overallReason}</p>
      </div>
      <dl className="evaluation-result-meta">
        <div><dt>模板版本</dt><dd>{templateName} · {result.templateVersion}</dd></div>
        <div><dt>Model Provider</dt><dd>{result.modelProviderName}</dd></div>
        <div><dt>实际模型</dt><dd>{actualModel}</dd></div>
      </dl>
      <div className="evaluation-result-dimensions">
        {result.dimensions.map((dimension) => (
          <article role="group" aria-label={dimension.dimensionName} key={dimension.dimensionId}>
            <header>
              <strong>{dimension.dimensionName}</strong>
              <span>{dimension.score} 分</span>
            </header>
            <div>
              <span>权重 {dimension.weight}%</span>
              <span>加权分 {dimension.weightedScore.toFixed(2)}</span>
            </div>
            <p>{dimension.reason}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function TimelineItem({ node }: { node: NodeExecution }) {
  const state = node.status === '失败' ? 'idle' : node.status === '运行中' ? 'running' : 'success'
  const evaluationResult = node.nodeType === 'evaluation' ? parseWorkflowEvaluationResult(node.output) : null
  const detail = evaluationResult?.overallReason
    ?? (node.nodeType === 'evaluation' && node.output
      ? '评估结果格式无效' : node.output || node.error || node.input)
  return (
    <div className={`timeline-item ${state}`}>
      <div className="timeline-marker"><Play size={14} /></div>
      <div><strong>{node.nodeName}</strong><span>{detail}</span></div>
      <small>{node.status} · {formatDuration(node.durationMs)} · 尝试 {node.attempts} 次</small>
      {node.score !== null && <b>{node.score} 分</b>}
    </div>
  )
}
