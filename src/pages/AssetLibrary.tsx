import { Check, FileJson, Pencil, Play, Plus, Power, ShieldOff, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  createToolSkillAsset,
  deactivateToolSkillAsset,
  getToolSkillAssetImpact,
  listToolSkillAssets,
  listToolSkillInvocations,
  testToolSkillAsset,
  updateToolSkillAsset,
} from '../api/assetLibrary'
import { useWorkspace } from '../auth/workspaceContextState'
import type {
  ToolSkillAdapterType,
  ToolSkillAsset,
  ToolSkillAssetCreateInput,
  ToolSkillAssetImpact,
  ToolSkillAssetUpdateInput,
  ToolSkillAssetType,
  ToolSkillInvocation,
} from '../types'

const emptyJson = '{}'

const initialForm = {
  assetType: 'tool' as ToolSkillAssetType,
  name: '',
  description: '',
  parameterSchemaJson: '{\n  "type": "object"\n}',
  adapterType: 'manual' as ToolSkillAdapterType,
  adapterConfigJson: emptyJson,
}

interface EditFormState {
  name: string
  description: string
  parameterSchemaJson: string
  adapterType: ToolSkillAdapterType
  adapterConfigJson: string
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} 必须是 JSON 对象`)
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(`${label} 必须是合法 JSON`)
  }
}

export function AssetLibrary() {
  const { workspace } = useWorkspace()
  const [assets, setAssets] = useState<ToolSkillAsset[]>([])
  const [invocations, setInvocations] = useState<ToolSkillInvocation[]>([])
  const [impactByAssetId, setImpactByAssetId] = useState<Record<string, ToolSkillAssetImpact>>({})
  const [testResults, setTestResults] = useState<Record<string, ToolSkillInvocation>>({})
  const [testParameterJsonByAssetId, setTestParameterJsonByAssetId] = useState<Record<string, string>>({})
  const [editingAssetId, setEditingAssetId] = useState('')
  const [editForm, setEditForm] = useState<EditFormState | null>(null)
  const [form, setForm] = useState(initialForm)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const loadAssetImpacts = useCallback(async (targetAssets: ToolSkillAsset[]) => {
    const entries = await Promise.all(targetAssets.map(async (asset) => {
      try {
        const impact = await getToolSkillAssetImpact(workspace.id, asset.id)
        return [asset.id, impact] as [string, ToolSkillAssetImpact]
      } catch {
        return null
      }
    }))
    setImpactByAssetId((current) => ({
      ...current,
      ...Object.fromEntries(entries.filter((entry): entry is [string, ToolSkillAssetImpact] => entry !== null)),
    }))
  }, [workspace.id])

  useEffect(() => {
    void Promise.all([
      listToolSkillAssets(workspace.id),
      listToolSkillInvocations(workspace.id),
    ])
      .then(([loadedAssets, loadedInvocations]) => {
        setAssets(loadedAssets)
        setInvocations(loadedInvocations)
        return loadAssetImpacts(loadedAssets)
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '资产库加载失败'))
  }, [loadAssetImpacts, workspace.id])

  function updateForm<TField extends keyof typeof initialForm>(field: TField, value: (typeof initialForm)[TField]) {
    setForm((current) => ({ ...current, [field]: value }))
    setFeedback('')
    setError('')
  }

  async function createAsset() {
    setIsBusy(true)
    setError('')
    try {
      const input: ToolSkillAssetCreateInput = {
        assetType: form.assetType,
        name: form.name.trim(),
        description: form.description.trim(),
        parameterSchema: parseJsonObject(form.parameterSchemaJson, '参数 Schema'),
        adapterType: form.adapterType,
        adapterConfig: parseJsonObject(form.adapterConfigJson, '适配配置'),
      }
      const created = await createToolSkillAsset(workspace.id, input)
      setAssets((current) => [created, ...current])
      setImpactByAssetId((current) => ({
        ...current,
        [created.id]: {
          assetId: created.id,
          assetType: created.assetType,
          assetName: created.name,
          totals: { draftAgents: 0, publishedVersions: 0 },
          draftAgents: [],
          publishedVersions: [],
        },
      }))
      setForm(initialForm)
      setFeedback('资产已创建')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '资产创建失败')
    } finally {
      setIsBusy(false)
    }
  }

  function updateTestParameters(assetId: string, value: string) {
    setTestParameterJsonByAssetId((current) => ({ ...current, [assetId]: value }))
    setFeedback('')
    setError('')
  }

  async function runTestInvocation(asset: ToolSkillAsset) {
    setIsBusy(true)
    setError('')
    try {
      const parameters = parseJsonObject(testParameterJsonByAssetId[asset.id] ?? emptyJson, '测试参数')
      const result = await testToolSkillAsset(workspace.id, asset.id, { parameters })
      setTestResults((current) => ({ ...current, [asset.id]: result }))
      const latest = await listToolSkillInvocations(workspace.id, asset.id)
      setInvocations((current) => [
        ...latest,
        ...current.filter((item) => item.assetId !== asset.id),
      ])
      setFeedback('测试调用完成')
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : '测试调用失败')
    } finally {
      setIsBusy(false)
    }
  }

  function startEditing(asset: ToolSkillAsset) {
    setEditingAssetId(asset.id)
    setEditForm({
      name: asset.name,
      description: asset.description,
      parameterSchemaJson: JSON.stringify(asset.parameterSchema, null, 2),
      adapterType: asset.adapterType,
      adapterConfigJson: JSON.stringify(asset.adapterConfig, null, 2),
    })
    setFeedback('')
    setError('')
  }

  function updateEditForm<TField extends keyof EditFormState>(field: TField, value: EditFormState[TField]) {
    setEditForm((current) => current ? { ...current, [field]: value } : current)
    setFeedback('')
    setError('')
  }

  async function saveAsset(asset: ToolSkillAsset) {
    if (!editForm) return
    setIsBusy(true)
    setError('')
    try {
      const input: ToolSkillAssetUpdateInput = {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        parameterSchema: parseJsonObject(editForm.parameterSchemaJson, '编辑参数 Schema'),
        adapterType: editForm.adapterType,
        adapterConfig: parseJsonObject(editForm.adapterConfigJson, '编辑适配配置'),
      }
      const updated = await updateToolSkillAsset(workspace.id, asset.id, input)
      setAssets((current) => current.map((item) => item.id === updated.id ? updated : item))
      setImpactByAssetId((current) => {
        const previousImpact = current[updated.id]
        return previousImpact ? {
          ...current,
          [updated.id]: { ...previousImpact, assetName: updated.name, assetType: updated.assetType },
        } : current
      })
      setEditingAssetId('')
      setEditForm(null)
      setFeedback('资产已更新')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '资产更新失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function deactivateAsset(asset: ToolSkillAsset) {
    setIsBusy(true)
    setError('')
    try {
      const disabled = await deactivateToolSkillAsset(workspace.id, asset.id)
      setAssets((current) => current.map((item) => item.id === disabled.id ? disabled : item))
      setFeedback('资产已停用')
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : '资产停用失败')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="page-stack asset-library-page">
      <section className="panel asset-library-intro">
        <div>
          <p className="section-kicker">TOOL & SKILL REGISTRY</p>
          <h2>Tool / Skill 资产库</h2>
          <p>统一管理 Agent 可绑定的工具、技能、参数 Schema 和适配配置。页面只维护配置，不录入密钥。</p>
        </div>
        <div className="provider-secret-note">
          <Wrench size={18} />
          <span>HTTP / MCP Tool 可在这里做一次受控测试调用</span>
        </div>
      </section>

      {(feedback || error) && (
        <div className={`inline-feedback ${error ? 'error' : ''}`} role="status">
          {error ? <ShieldOff size={15} /> : <Check size={15} />}
          {error || feedback}
        </div>
      )}

      <section className="panel asset-library-form-panel">
        <header className="panel-header">
          <div><span className="section-kicker">配置入口</span><h3>新增 Tool / Skill</h3></div>
          <Plus size={17} />
        </header>
        <div className="asset-form-grid">
          <label className="form-field">
            <span>资产类型</span>
            <select
              aria-label="资产类型"
              value={form.assetType}
              onChange={(event) => updateForm('assetType', event.target.value as ToolSkillAssetType)}
            >
              <option value="tool">tool</option>
              <option value="skill">skill</option>
            </select>
          </label>
          <label className="form-field">
            <span>资产名称</span>
            <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} />
          </label>
          <label className="form-field">
            <span>适配类型</span>
            <select
              aria-label="适配类型"
              value={form.adapterType}
              onChange={(event) => updateForm('adapterType', event.target.value as ToolSkillAdapterType)}
            >
              <option value="manual">manual</option>
              <option value="http">http</option>
              <option value="mcp">mcp</option>
            </select>
          </label>
          <label className="form-field full">
            <span>描述</span>
            <input value={form.description} onChange={(event) => updateForm('description', event.target.value)} />
          </label>
          <label className="form-field full">
            <span>参数 Schema JSON</span>
            <textarea
              aria-label="参数 Schema JSON"
              value={form.parameterSchemaJson}
              onChange={(event) => updateForm('parameterSchemaJson', event.target.value)}
              rows={4}
            />
          </label>
          <label className="form-field full">
            <span>适配配置 JSON</span>
            <textarea
              aria-label="适配配置 JSON"
              value={form.adapterConfigJson}
              onChange={(event) => updateForm('adapterConfigJson', event.target.value)}
              rows={4}
            />
          </label>
        </div>
        <button className="button primary" disabled={isBusy} onClick={() => void createAsset()}>
          <Plus size={15} />创建资产
        </button>
      </section>

      <section className="asset-library-grid">
        <div className="panel">
          <header className="panel-header">
            <div><span className="section-kicker">资产列表</span><h3>Tool / Skill</h3></div>
            <span className="draft-indicator"><i />{assets.length}</span>
          </header>
          <div className="asset-library-list">
            {assets.length === 0 && <div className="table-state">暂无 Tool / Skill 资产。</div>}
            {assets.map((asset) => {
              const canTest = asset.assetType === 'tool' && (asset.adapterType === 'http' || asset.adapterType === 'mcp')
              const result = testResults[asset.id]
              const impact = impactByAssetId[asset.id]
              const isEditing = editingAssetId === asset.id && editForm
              return (
                <article className="asset-library-card" key={asset.id}>
                  <div className="asset-library-card-head">
                    <FileJson size={17} />
                    <div>
                      <strong>{asset.name}</strong>
                      <span>{asset.assetType} · {asset.adapterType} · {asset.status}</span>
                    </div>
                    <div className="asset-card-actions">
                      <button
                        aria-label={`编辑 ${asset.name}`}
                        className="icon-button"
                        onClick={() => startEditing(asset)}
                        type="button"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        aria-label={`停用 ${asset.name}`}
                        className="icon-button"
                        disabled={isBusy || asset.status === 'disabled'}
                        onClick={() => void deactivateAsset(asset)}
                        type="button"
                      >
                        <Power size={15} />
                      </button>
                    </div>
                  </div>
                  <p>{asset.description || '暂无描述'}</p>
                  {isEditing && (
                    <div className="asset-edit-form">
                      <label className="form-field">
                        <span>编辑资产名称</span>
                        <input
                          aria-label="编辑资产名称"
                          value={editForm.name}
                          onChange={(event) => updateEditForm('name', event.target.value)}
                        />
                      </label>
                      <label className="form-field">
                        <span>编辑适配类型</span>
                        <select
                          aria-label="编辑适配类型"
                          value={editForm.adapterType}
                          onChange={(event) => updateEditForm('adapterType', event.target.value as ToolSkillAdapterType)}
                        >
                          <option value="manual">manual</option>
                          <option value="http">http</option>
                          <option value="mcp">mcp</option>
                        </select>
                      </label>
                      <label className="form-field full">
                        <span>编辑描述</span>
                        <input
                          aria-label="编辑描述"
                          value={editForm.description}
                          onChange={(event) => updateEditForm('description', event.target.value)}
                        />
                      </label>
                      <label className="form-field full">
                        <span>编辑参数 Schema JSON</span>
                        <textarea
                          aria-label="编辑参数 Schema JSON"
                          value={editForm.parameterSchemaJson}
                          onChange={(event) => updateEditForm('parameterSchemaJson', event.target.value)}
                          rows={4}
                        />
                      </label>
                      <label className="form-field full">
                        <span>编辑适配配置 JSON</span>
                        <textarea
                          aria-label="编辑适配配置 JSON"
                          value={editForm.adapterConfigJson}
                          onChange={(event) => updateEditForm('adapterConfigJson', event.target.value)}
                          rows={4}
                        />
                      </label>
                      <div className="asset-edit-actions">
                        <button
                          className="button secondary compact"
                          onClick={() => {
                            setEditingAssetId('')
                            setEditForm(null)
                          }}
                          type="button"
                        >
                          取消
                        </button>
                        <button
                          aria-label={`保存 ${asset.name}`}
                          className="button primary compact"
                          disabled={isBusy}
                          onClick={() => void saveAsset(asset)}
                          type="button"
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  )}
                  {impact && (
                    <div className="asset-impact">
                      <div className="asset-impact-metrics">
                        <span>草稿 Agent {impact.totals.draftAgents}</span>
                        <span>已发布版本 {impact.totals.publishedVersions}</span>
                      </div>
                      {(impact.draftAgents.length > 0 || impact.publishedVersions.length > 0) && (
                        <ul>
                          {impact.draftAgents.slice(0, 3).map((agent) => (
                            <li key={`draft-${agent.agentId}`}>{agent.agentName}</li>
                          ))}
                          {impact.publishedVersions.slice(0, 3).map((version) => (
                            <li key={`version-${version.versionId}`}>{version.agentName} {version.version}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {canTest && (
                    <div className="asset-test-form">
                      <label className="form-field">
                        <span>测试参数 {asset.name}</span>
                        <textarea
                          aria-label={`测试参数 ${asset.name}`}
                          value={testParameterJsonByAssetId[asset.id] ?? emptyJson}
                          onChange={(event) => updateTestParameters(asset.id, event.target.value)}
                          rows={3}
                        />
                      </label>
                      <button
                        className="button secondary compact"
                        disabled={isBusy}
                        onClick={() => void runTestInvocation(asset)}
                        aria-label={`测试调用 ${asset.name}`}
                      >
                        <Play size={15} />测试调用
                      </button>
                      {result && (
                        <div className="asset-test-result">
                          <span>{result.status}</span>
                          {result.outputSummary && <strong>{result.outputSummary}</strong>}
                          {result.error && <p>{result.error}</p>}
                          <small>{result.durationMs} ms</small>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </div>

        <aside className="panel asset-invocation-list">
          <header className="panel-header">
            <div><span className="section-kicker">调用日志</span><h3>最近调用</h3></div>
          </header>
          {invocations.length === 0 ? (
            <div className="table-state">暂无调用日志。</div>
          ) : (
            <ul>
              {invocations.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <strong>{item.assetName}</strong>
                  <span>{item.status} · {item.durationMs} ms</span>
                  {item.inputSummary && <p>{item.inputSummary}</p>}
                  {item.outputSummary && <p>{item.outputSummary}</p>}
                  {item.error && <p>{item.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </section>
    </div>
  )
}
