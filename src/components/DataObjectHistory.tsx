import { useEffect, useState } from 'react'
import { listDataObjectVersions } from '../api/dataObjects'
import type { DataObjectVersion } from '../types'

/** Display persisted snapshots only; never derive history from the editable draft. */
export function DataObjectHistory({ workspaceId, definitionId }: { workspaceId: string; definitionId: string }) {
  const [versions, setVersions] = useState<DataObjectVersion[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setVersions(null)
    setError('')
    void listDataObjectVersions(workspaceId, definitionId).then(items => {
      if (!Array.isArray(items)) throw new Error('历史版本响应格式错误')
      if (active) setVersions(items)
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : '历史版本加载失败')
    })
    return () => { active = false }
  }, [workspaceId, definitionId, attempt])
  return <section className="data-object-history" aria-label="历史版本">
    <h4>已发布版本（只读）</h4>
    {error ? <div role="alert">
      <p>{error}</p>
      <button type="button" className="button secondary compact" onClick={() => setAttempt(value => value + 1)}>重试历史版本</button>
    </div> : versions === null ? <p role="status">正在加载历史版本…</p>
      : versions.length === 0 ? <p>暂无已发布版本</p>
        : versions.map(version => <div key={version.id}>
          <p>{version.version} · {version.createdAt}</p>
          <label className="form-field full">
            <span>Schema {version.version}</span>
            <textarea aria-label={`Schema ${version.version}`} readOnly rows={6}
              value={JSON.stringify(version.snapshot.schema, null, 2)} />
          </label>
        </div>)}
  </section>
}
