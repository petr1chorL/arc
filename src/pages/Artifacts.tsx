import { Check, Database, Eye, FileJson, Filter, RotateCcw, Route, ShieldOff, Wrench, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { listArtifacts } from '../api/artifacts'
import { createRemediationTask } from '../api/evaluations'
import { useWorkspace } from '../auth/workspaceContextState'
import type { ArtifactCatalogItem } from '../types'
import type { RemediationTask } from '../types'

type SchemaValidationStatus = 'passed' | 'failed' | 'unchecked'
type SchemaStatusFilterValue = SchemaValidationStatus | ''

interface SchemaValidationResult {
  status: SchemaValidationStatus
  label: string
  reasons: string[]
}

function formatDate(value: string) {
  if (!value) return '未知时间'
  return value.slice(0, 16).replace('T', ' ')
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null || durationMs === undefined) return '-'
  if (durationMs <= 0) return '0 ms'
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(2)} s`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function schemaSummary(snapshot: Record<string, unknown> | null) {
  const schema = snapshot?.schema
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return '未记录 Schema'
  }
  const record = schema as Record<string, unknown>
  const required = Array.isArray(record.required)
    ? record.required.filter((item): item is string => typeof item === 'string')
    : []
  const properties = record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
    ? Object.keys(record.properties)
    : []
  if (required.length > 0) return `required: ${required.join(', ')}`
  if (properties.length > 0) return `fields: ${properties.slice(0, 6).join(', ')}`
  return 'object schema'
}

function snapshotName(snapshot: Record<string, unknown> | null) {
  const name = snapshot?.name
  return typeof name === 'string' && name.trim() ? name : '未绑定 Data Object'
}

function formatJsonText(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function formatSnapshot(snapshot: Record<string, unknown> | null) {
  if (!snapshot) return '未绑定 Data Object Snapshot'
  return JSON.stringify(snapshot, null, 2)
}

function matchesSchemaType(value: unknown, schemaType: string) {
  if (schemaType === 'string') return typeof value === 'string'
  if (schemaType === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (schemaType === 'integer') return Number.isInteger(value)
  if (schemaType === 'boolean') return typeof value === 'boolean'
  if (schemaType === 'object') return isRecord(value)
  return true
}

function validateArtifactSchema(artifact: ArtifactCatalogItem): SchemaValidationResult {
  const schema = artifact.dataObjectSnapshot?.schema
  if (!isRecord(schema) || schema.type !== 'object') {
    return { status: 'unchecked', label: '未校验', reasons: ['未绑定可校验的对象 Schema'] }
  }

  let content: unknown
  try {
    content = JSON.parse(artifact.content)
  } catch {
    return { status: 'failed', label: 'Schema 校验失败', reasons: ['内容不是合法 JSON 对象'] }
  }

  if (!isRecord(content)) {
    return { status: 'failed', label: 'Schema 校验失败', reasons: ['内容不是合法 JSON 对象'] }
  }

  const reasons: string[] = []
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : []
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(content, field)) {
      reasons.push(`缺少必填字段：${field}`)
    }
  }

  const properties = isRecord(schema.properties) ? schema.properties : {}
  for (const [field, definition] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(content, field) || !isRecord(definition)) continue
    const schemaType = definition.type
    if (typeof schemaType === 'string' && !matchesSchemaType(content[field], schemaType)) {
      reasons.push(`字段 ${field} 类型应为 ${schemaType}`)
    }
  }

  if (reasons.length > 0) {
    return { status: 'failed', label: 'Schema 校验失败', reasons }
  }
  return { status: 'passed', label: 'Schema 校验通过', reasons: [] }
}

function schemaValidationForArtifact(artifact: ArtifactCatalogItem): SchemaValidationResult {
  return artifact.schemaValidation ?? validateArtifactSchema(artifact)
}

function shouldOfferRemediation(artifact: ArtifactCatalogItem, validation: SchemaValidationResult) {
  return validation.status === 'failed' || (artifact.score ?? 100) < 75
}

function remediationActionForArtifact(artifact: ArtifactCatalogItem, validation: SchemaValidationResult) {
  const reasons = validation.reasons.length > 0
    ? validation.reasons.join('；')
    : `当前得分 ${artifact.score ?? '待评估'}，需要复核产出质量。`
  return [
    `检查 Artifact ${artifact.artifactVersionId} 的输出结构。`,
    `Run：${artifact.runId}`,
    `NodeRun：${artifact.sourceNodeRunId}`,
    `来源节点：${artifact.sourceNodeName ?? '未知'}`,
    `失败原因：${reasons}`,
  ].join('\n')
}

function schemaStatusFilterFromParams(searchParams: URLSearchParams): SchemaStatusFilterValue {
  const status = searchParams.get('schemaValidationStatus')
  if (status === 'passed' || status === 'failed' || status === 'unchecked') return status
  return ''
}

export function Artifacts() {
  const { workspace, workspacePath } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const filterParam = searchParams.get('dataObjectDefinitionId') ?? ''
  const schemaStatusFilterParam = schemaStatusFilterFromParams(searchParams)
  const runIdParam = searchParams.get('runId') ?? ''
  const sourceNodeRunIdParam = searchParams.get('sourceNodeRunId') ?? ''
  const [artifacts, setArtifacts] = useState<ArtifactCatalogItem[]>([])
  const [filter, setFilter] = useState(filterParam)
  const [schemaStatusFilter, setSchemaStatusFilter] = useState<SchemaStatusFilterValue>(schemaStatusFilterParam)
  const [appliedFilter, setAppliedFilter] = useState(filterParam)
  const [appliedSchemaStatusFilter, setAppliedSchemaStatusFilter] = useState<SchemaStatusFilterValue>(schemaStatusFilterParam)
  const [appliedRunId, setAppliedRunId] = useState(runIdParam)
  const [appliedSourceNodeRunId, setAppliedSourceNodeRunId] = useState(sourceNodeRunIdParam)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactCatalogItem | null>(null)
  const [remediationTasksByArtifact, setRemediationTasksByArtifact] = useState<Record<string, RemediationTask>>({})
  const [remediationBusyArtifactId, setRemediationBusyArtifactId] = useState('')
  const [remediationErrorByArtifact, setRemediationErrorByArtifact] = useState<Record<string, string>>({})
  const selectedArtifactVersionId = searchParams.get('artifactVersionId')
  const selectedValidation = selectedArtifact ? schemaValidationForArtifact(selectedArtifact) : null

  useEffect(() => {
    setFilter(filterParam)
    setSchemaStatusFilter(schemaStatusFilterParam)
    setAppliedFilter(filterParam)
    setAppliedSchemaStatusFilter(schemaStatusFilterParam)
    setAppliedRunId(runIdParam)
    setAppliedSourceNodeRunId(sourceNodeRunIdParam)
  }, [filterParam, runIdParam, schemaStatusFilterParam, sourceNodeRunIdParam])

  useEffect(() => {
    setIsLoading(true)
    setError('')
    void listArtifacts(workspace.id, {
      dataObjectDefinitionId: appliedFilter,
      schemaValidationStatus: appliedSchemaStatusFilter,
      runId: appliedRunId,
      sourceNodeRunId: appliedSourceNodeRunId,
    })
      .then(setArtifacts)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Artifact 加载失败'))
      .finally(() => setIsLoading(false))
  }, [appliedFilter, appliedRunId, appliedSchemaStatusFilter, appliedSourceNodeRunId, workspace.id])

  useEffect(() => {
    if (!selectedArtifactVersionId) {
      setSelectedArtifact(null)
      return
    }
    const artifact = artifacts.find((item) => item.artifactVersionId === selectedArtifactVersionId)
    if (artifact) {
      setSelectedArtifact(artifact)
    }
  }, [artifacts, selectedArtifactVersionId])

  const boundCount = artifacts.filter((artifact) => artifact.dataObjectDefinitionId).length
  const averageScore = useMemo(() => {
    const scores = artifacts
      .map((artifact) => artifact.score)
      .filter((score): score is number => typeof score === 'number')
    if (scores.length === 0) return null
    return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
  }, [artifacts])

  function applyFilter() {
    const nextFilter = filter.trim()
    const nextParams = new URLSearchParams(searchParams)
    if (nextFilter) {
      nextParams.set('dataObjectDefinitionId', nextFilter)
    } else {
      nextParams.delete('dataObjectDefinitionId')
    }
    if (schemaStatusFilter) {
      nextParams.set('schemaValidationStatus', schemaStatusFilter)
    } else {
      nextParams.delete('schemaValidationStatus')
    }
    setAppliedFilter(nextFilter)
    setAppliedSchemaStatusFilter(schemaStatusFilter)
    setSearchParams(nextParams)
  }

  function clearFilter() {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('dataObjectDefinitionId')
    nextParams.delete('schemaValidationStatus')
    nextParams.delete('runId')
    nextParams.delete('sourceNodeRunId')
    setFilter('')
    setSchemaStatusFilter('')
    setAppliedFilter('')
    setAppliedSchemaStatusFilter('')
    setAppliedRunId('')
    setAppliedSourceNodeRunId('')
    setSearchParams(nextParams)
  }

  function openArtifactDetail(artifact: ArtifactCatalogItem) {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('artifactVersionId', artifact.artifactVersionId)
    setSelectedArtifact(artifact)
    setSearchParams(nextParams)
  }

  function closeArtifactDetail() {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('artifactVersionId')
    setSelectedArtifact(null)
    setSearchParams(nextParams)
  }

  function artifactTracePath(artifact: ArtifactCatalogItem) {
    const params = new URLSearchParams({
      runId: artifact.runId,
      nodeRunId: artifact.sourceNodeRunId,
    })
    return workspacePath(`observability?${params.toString()}`)
  }

  function remediationTaskPath(task: RemediationTask) {
    const params = new URLSearchParams({ taskId: task.id })
    return workspacePath(`quality-operations?${params.toString()}`)
  }

  async function createArtifactRemediationTask(
    artifact: ArtifactCatalogItem,
    validation: SchemaValidationResult,
  ) {
    setRemediationBusyArtifactId(artifact.artifactVersionId)
    setRemediationErrorByArtifact((current) => ({ ...current, [artifact.artifactVersionId]: '' }))
    try {
      const task = await createRemediationTask(workspace.id, {
        sourceRunId: artifact.runId,
        clusterKey: `artifact:${artifact.artifactVersionId}`,
        title: `修复 Artifact ${artifact.artifactVersionId} 的结构输出`,
        priority: validation.status === 'failed' ? 'P1' : 'P2',
        sampleIds: [artifact.artifactVersionId],
        action: remediationActionForArtifact(artifact, validation),
      })
      setRemediationTasksByArtifact((current) => ({
        ...current,
        [artifact.artifactVersionId]: task,
      }))
    } catch (taskError) {
      setRemediationErrorByArtifact((current) => ({
        ...current,
        [artifact.artifactVersionId]: taskError instanceof Error ? taskError.message : '修复任务创建失败',
      }))
    } finally {
      setRemediationBusyArtifactId('')
    }
  }

  const activeFilters = [
    appliedFilter ? `Definition：${appliedFilter}` : '',
    appliedSchemaStatusFilter ? `Schema：${appliedSchemaStatusFilter}` : '',
    appliedRunId ? `Run：${appliedRunId}` : '',
    appliedSourceNodeRunId ? `NodeRun：${appliedSourceNodeRunId}` : '',
  ].filter(Boolean).join(' / ')

  return (
    <div className="page-stack artifact-catalog-page">
      <section className="panel asset-library-intro">
        <div>
          <p className="section-kicker">ARTIFACT CATALOG</p>
          <h2>产出物</h2>
          <p>查看工作流运行生成的 ArtifactVersion，以及它们绑定的 Data Object 版本快照。</p>
        </div>
        <div className="provider-secret-note">
          <FileJson size={18} />
          <span>{boundCount} 个产出物已绑定 Data Object</span>
        </div>
      </section>

      {(error || activeFilters) && (
        <div className={`inline-feedback ${error ? 'error' : ''}`} role="status">
          {error ? <ShieldOff size={15} /> : <Check size={15} />}
          {error || `当前筛选：${activeFilters}`}
        </div>
      )}

      <section className="artifact-summary-grid">
        <div className="metric-card">
          <span>ArtifactVersion</span>
          <strong>{artifacts.length}</strong>
          <small>当前列表</small>
        </div>
        <div className="metric-card">
          <span>Data Object 绑定</span>
          <strong>{boundCount}</strong>
          <small>可追溯契约</small>
        </div>
        <div className="metric-card">
          <span>平均得分</span>
          <strong>{averageScore ?? '-'}</strong>
          <small>有评分样本</small>
        </div>
      </section>

      <section className="panel artifact-filter-panel">
        <label className="form-field">
          <span>Data Object Definition ID</span>
          <input
            aria-label="Data Object Definition ID"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="data-object-..."
          />
        </label>
        <label className="form-field">
          <span>Schema 校验状态</span>
          <select
            aria-label="Schema 校验状态"
            value={schemaStatusFilter}
            onChange={(event) => setSchemaStatusFilter(event.target.value as SchemaStatusFilterValue)}
          >
            <option value="">全部</option>
            <option value="failed">失败</option>
            <option value="passed">通过</option>
            <option value="unchecked">未校验</option>
          </select>
        </label>
        <button className="button primary" type="button" onClick={applyFilter}>
          <Filter size={15} />筛选
        </button>
        <button className="button ghost" type="button" onClick={clearFilter}>
          <RotateCcw size={15} />清空
        </button>
      </section>

      <section className="panel">
        <header className="panel-header">
          <div><span className="section-kicker">实例列表</span><h3>Artifact Instances</h3></div>
          <span className="draft-indicator"><i />{artifacts.length}</span>
        </header>
        {isLoading && <div className="table-state">正在加载 Artifact。</div>}
        {!isLoading && artifacts.length === 0 && <div className="table-state">暂无 Artifact 实例。</div>}
        {!isLoading && artifacts.length > 0 && (
          <div className="artifact-catalog-list">
            {artifacts.map((artifact) => {
              const validation = schemaValidationForArtifact(artifact)
              const remediationTask = remediationTasksByArtifact[artifact.artifactVersionId]
              const remediationError = remediationErrorByArtifact[artifact.artifactVersionId]
              const isRemediationBusy = remediationBusyArtifactId === artifact.artifactVersionId
              return (
                <article className="asset-library-card artifact-card" key={artifact.artifactVersionId}>
                  <div className="asset-library-card-head">
                    <Database size={17} />
                    <div>
                      <strong>{snapshotName(artifact.dataObjectSnapshot)}</strong>
                      <span>{artifact.artifactVersionId} · v{artifact.version}</span>
                    </div>
                    <span className="score-pill">{artifact.score ?? '-'}</span>
                  </div>
                  <div className="artifact-contract-row">
                    <span>{artifact.dataObjectDefinitionId ?? '未绑定 Definition'}</span>
                    <span>{artifact.dataObjectVersionId ?? '未绑定 Version'}</span>
                    <span>{schemaSummary(artifact.dataObjectSnapshot)}</span>
                    <span className={`schema-status-pill ${validation.status}`}>{validation.label}</span>
                  </div>
                  <div className="artifact-source-context-row">
                    <span>工作流</span><strong>{artifact.workflowName ?? artifact.runId}</strong>
                    <span>节点</span><strong>{artifact.sourceNodeName ?? artifact.sourceNodeRunId}</strong>
                    <span>{artifact.sourceNodeStatus ?? artifact.runStatus ?? '未知状态'}</span>
                  </div>
                  <div className="artifact-source-row">
                    <span>Run</span><strong>{artifact.runId}</strong>
                    <span>NodeRun</span><strong>{artifact.sourceNodeRunId}</strong>
                    <span>{formatDate(artifact.createdAt)}</span>
                  </div>
                  <pre className="artifact-content-preview">{artifact.content}</pre>
                  <div className="artifact-card-actions">
                    <Link
                      aria-label={`查看 ${artifact.artifactVersionId} 运行链路`}
                      className="button ghost"
                      to={artifactTracePath(artifact)}
                    >
                      <Route size={15} />查看运行链路
                    </Link>
                    {shouldOfferRemediation(artifact, validation) && !remediationTask && (
                      <button
                        aria-label={`创建 ${artifact.artifactVersionId} 修复任务`}
                        className="button ghost"
                        disabled={isRemediationBusy}
                        type="button"
                        onClick={() => void createArtifactRemediationTask(artifact, validation)}
                      >
                        <Wrench size={15} />{isRemediationBusy ? '创建中' : '创建修复任务'}
                      </button>
                    )}
                    <button
                      aria-label={`查看 ${artifact.artifactVersionId} 详情`}
                      className="button ghost"
                      type="button"
                      onClick={() => openArtifactDetail(artifact)}
                    >
                      <Eye size={15} />查看详情
                    </button>
                  </div>
                  {remediationTask && (
                    <div className="inline-feedback" role="status">
                      <Check size={15} />已创建修复任务 {remediationTask.id}
                      <Link
                        aria-label={`查看 ${remediationTask.id} 修复任务`}
                        className="button ghost"
                        to={remediationTaskPath(remediationTask)}
                      >
                        <Route size={15} />查看修复任务
                      </Link>
                    </div>
                  )}
                  {remediationError && (
                    <div className="inline-feedback error" role="alert">
                      <ShieldOff size={15} />{remediationError}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      {selectedArtifact && (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-label="Artifact 详情"
            className="artifact-detail-dialog"
            role="dialog"
            aria-modal="true"
          >
            <header className="artifact-detail-head">
              <div>
                <span className="section-kicker">ARTIFACT DETAIL</span>
                <h3>Artifact 详情</h3>
              </div>
              <div className="artifact-detail-actions">
                <Link
                  className="button ghost"
                  to={artifactTracePath(selectedArtifact)}
                >
                  <Route size={15} />查看运行链路
                </Link>
                <button
                  aria-label="关闭 Artifact 详情"
                  className="icon-button"
                  type="button"
                  onClick={closeArtifactDetail}
                >
                  <X size={17} />
                </button>
              </div>
            </header>
            <div className="artifact-detail-meta">
              <span>ArtifactVersion</span><strong>{selectedArtifact.artifactVersionId}</strong>
              <span>Artifact</span><strong>{selectedArtifact.artifactId}</strong>
              <span>Run</span><strong>{selectedArtifact.runId}</strong>
              <span>NodeRun</span><strong>{selectedArtifact.sourceNodeRunId}</strong>
              <span>Data Object Version</span><strong>{selectedArtifact.dataObjectVersionId ?? '未绑定'}</strong>
              <span>Score</span><strong>{selectedArtifact.score ?? '-'}</strong>
              <span>Schema 状态</span><strong>{selectedValidation?.label}</strong>
            </div>
            <section className="artifact-source-context-box">
              <h4>来源上下文</h4>
              <div className="artifact-detail-meta">
                <span>工作流</span><strong>{selectedArtifact.workflowName ?? selectedArtifact.runId}</strong>
                <span>运行状态</span><strong>{selectedArtifact.runStatus ?? '未知'}</strong>
                <span>节点</span><strong>{selectedArtifact.sourceNodeName ?? selectedArtifact.sourceNodeRunId}</strong>
                <span>节点类型</span><strong>{selectedArtifact.sourceNodeType ?? '未知'}</strong>
                <span>节点状态</span><strong>{selectedArtifact.sourceNodeStatus ?? '未知'}</strong>
                <span>节点耗时</span><strong>{formatDuration(selectedArtifact.sourceNodeDurationMs)}</strong>
                <span>节点得分</span><strong>{selectedArtifact.sourceNodeScore ?? '-'}</strong>
              </div>
            </section>
            {selectedValidation && selectedValidation.reasons.length > 0 && (
              <section className={`artifact-validation-box ${selectedValidation.status}`}>
                <h4>校验原因</h4>
                <ul>
                  {selectedValidation.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </section>
            )}
            <div className="artifact-detail-grid">
              <section>
                <h4>格式化内容</h4>
                <pre className="artifact-detail-code">{formatJsonText(selectedArtifact.content)}</pre>
              </section>
              <section>
                <h4>Data Object Snapshot</h4>
                <pre className="artifact-detail-code">{formatSnapshot(selectedArtifact.dataObjectSnapshot)}</pre>
              </section>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
