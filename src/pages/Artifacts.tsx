import { Check, Database, FileJson, Filter, RotateCcw, ShieldOff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listArtifacts } from '../api/artifacts'
import { useWorkspace } from '../auth/workspaceContextState'
import type { ArtifactCatalogItem } from '../types'

function formatDate(value: string) {
  if (!value) return '未知时间'
  return value.slice(0, 16).replace('T', ' ')
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

export function Artifacts() {
  const { workspace } = useWorkspace()
  const [artifacts, setArtifacts] = useState<ArtifactCatalogItem[]>([])
  const [filter, setFilter] = useState('')
  const [appliedFilter, setAppliedFilter] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setIsLoading(true)
    setError('')
    void listArtifacts(workspace.id, appliedFilter ? { dataObjectDefinitionId: appliedFilter } : {})
      .then(setArtifacts)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Artifact 加载失败'))
      .finally(() => setIsLoading(false))
  }, [appliedFilter, workspace.id])

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
  }

  function clearFilter() {
    setFilter('')
    setAppliedFilter('')
  }

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

      {(error || appliedFilter) && (
        <div className={`inline-feedback ${error ? 'error' : ''}`} role="status">
          {error ? <ShieldOff size={15} /> : <Check size={15} />}
          {error || `当前筛选：${appliedFilter}`}
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
            {artifacts.map((artifact) => (
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
                </div>
                <div className="artifact-source-row">
                  <span>Run</span><strong>{artifact.runId}</strong>
                  <span>NodeRun</span><strong>{artifact.sourceNodeRunId}</strong>
                  <span>{formatDate(artifact.createdAt)}</span>
                </div>
                <pre className="artifact-content-preview">{artifact.content}</pre>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
