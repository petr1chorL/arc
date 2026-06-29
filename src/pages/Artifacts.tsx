import { Check, Database, Eye, FileJson, Filter, RotateCcw, ShieldOff, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listArtifacts } from '../api/artifacts'
import { useWorkspace } from '../auth/workspaceContextState'
import type { ArtifactCatalogItem } from '../types'

type SchemaValidationStatus = 'passed' | 'failed' | 'unchecked'

interface SchemaValidationResult {
  status: SchemaValidationStatus
  label: string
  reasons: string[]
}

function formatDate(value: string) {
  if (!value) return '未知时间'
  return value.slice(0, 16).replace('T', ' ')
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

export function Artifacts() {
  const { workspace } = useWorkspace()
  const [artifacts, setArtifacts] = useState<ArtifactCatalogItem[]>([])
  const [filter, setFilter] = useState('')
  const [schemaStatusFilter, setSchemaStatusFilter] = useState('')
  const [appliedFilter, setAppliedFilter] = useState('')
  const [appliedSchemaStatusFilter, setAppliedSchemaStatusFilter] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactCatalogItem | null>(null)
  const selectedValidation = selectedArtifact ? schemaValidationForArtifact(selectedArtifact) : null

  useEffect(() => {
    setIsLoading(true)
    setError('')
    void listArtifacts(workspace.id, {
      dataObjectDefinitionId: appliedFilter,
      schemaValidationStatus: appliedSchemaStatusFilter as 'passed' | 'failed' | 'unchecked' | '',
    })
      .then(setArtifacts)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Artifact 加载失败'))
      .finally(() => setIsLoading(false))
  }, [appliedFilter, appliedSchemaStatusFilter, workspace.id])

  const boundCount = artifacts.filter((artifact) => artifact.dataObjectDefinitionId).length
  const averageScore = useMemo(() => {
    const scores = artifacts
      .map((artifact) => artifact.score)
      .filter((score): score is number => typeof score === 'number')
    if (scores.length === 0) return null
    return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
  }, [artifacts])

  function applyFilter() {
    setAppliedFilter(filter.trim())
    setAppliedSchemaStatusFilter(schemaStatusFilter)
  }

  function clearFilter() {
    setFilter('')
    setSchemaStatusFilter('')
    setAppliedFilter('')
    setAppliedSchemaStatusFilter('')
  }

  const activeFilters = [
    appliedFilter ? `Definition：${appliedFilter}` : '',
    appliedSchemaStatusFilter ? `Schema：${appliedSchemaStatusFilter}` : '',
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
            onChange={(event) => setSchemaStatusFilter(event.target.value)}
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
                  <div className="artifact-source-row">
                    <span>Run</span><strong>{artifact.runId}</strong>
                    <span>NodeRun</span><strong>{artifact.sourceNodeRunId}</strong>
                    <span>{formatDate(artifact.createdAt)}</span>
                  </div>
                  <pre className="artifact-content-preview">{artifact.content}</pre>
                  <div className="artifact-card-actions">
                    <button
                      aria-label={`查看 ${artifact.artifactVersionId} 详情`}
                      className="button ghost"
                      type="button"
                      onClick={() => setSelectedArtifact(artifact)}
                    >
                      <Eye size={15} />查看详情
                    </button>
                  </div>
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
              <button
                aria-label="关闭 Artifact 详情"
                className="icon-button"
                type="button"
                onClick={() => setSelectedArtifact(null)}
              >
                <X size={17} />
              </button>
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
