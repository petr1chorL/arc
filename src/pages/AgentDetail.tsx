import {
  ArrowLeft,
  Check,
  History,
  Package,
  PackageCheck,
  Play,
  Save,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useWorkspace } from '../auth/workspaceContextState'
import {
  activateAgent,
  deactivateAgent,
  getAgent,
  listAgentVersions,
  publishAgent,
  updateAgent,
  type UpdateAgentInput,
} from '../api/agents'
import { runAgent } from '../api/execution'
import { listToolSkillAssets } from '../api/assetLibrary'
import { listModelProviders } from '../api/modelProviders'
import { StatusBadge } from '../components/StatusBadge'
import { displayStatus } from '../domain/statusText'
import type {
  Agent,
  AgentRuntimeManifest,
  AgentVersion,
  ExecutionRun,
  ModelProvider,
  ToolSkillAsset,
} from '../types'

function joinValues(values: string[]) {
  return values.join(', ')
}

function splitValues(value: string) {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
}

function toggleValue(text: string, value: string, checked: boolean) {
  const values = splitValues(text)
  const nextValues = checked
    ? Array.from(new Set([...values, value]))
    : values.filter((item) => item !== value)
  return joinValues(nextValues)
}

function runtimeTitle(manifest: AgentRuntimeManifest) {
  if (manifest.packageName && manifest.packageVersion) {
    return `${manifest.packageName}==${manifest.packageVersion}`
  }
  return manifest.entrypoint || '尚未导入 Python Package'
}

function packageDraftFromManifest(manifest: AgentRuntimeManifest) {
  return {
    packageName: manifest.packageName ?? '',
    packageVersion: manifest.packageVersion ?? '',
    entrypoint: manifest.entrypoint ?? '',
    packageHash: manifest.packageHash ?? '',
  }
}

function hasPythonPackageRuntime(manifest?: AgentRuntimeManifest) {
  return Boolean(
    manifest?.sourceType === 'python_package'
    && manifest.packageName
    && manifest.packageVersion
    && manifest.entrypoint,
  )
}

export function AgentDetail() {
  const { workspace, workspacePath } = useWorkspace()
  const { agentId = '' } = useParams()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [versions, setVersions] = useState<AgentVersion[]>([])
  const [modelProviders, setModelProviders] = useState<ModelProvider[]>([])
  const [toolSkillAssets, setToolSkillAssets] = useState<ToolSkillAsset[]>([])
  const [form, setForm] = useState<UpdateAgentInput | null>(null)
  const [toolsText, setToolsText] = useState('')
  const [skillsText, setSkillsText] = useState('')
  const [temperatureText, setTemperatureText] = useState('0.2')
  const [maxOutputTokensText, setMaxOutputTokensText] = useState('2000')
  const [packageDraft, setPackageDraft] = useState(packageDraftFromManifest({}))
  const [runtimeFeedback, setRuntimeFeedback] = useState('')
  const [runtimeError, setRuntimeError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [runInput, setRunInput] = useState('')
  const [runResult, setRunResult] = useState<ExecutionRun | null>(null)
  const [showPublishNote, setShowPublishNote] = useState(false)
  const [publishNote, setPublishNote] = useState('')
  const [publishNoteError, setPublishNoteError] = useState('')

  const load = useCallback(async () => {
    try {
      const [nextAgent, nextVersions, providerAssets, workspaceAssets] = await Promise.all([
        getAgent(workspace.id, agentId),
        listAgentVersions(workspace.id, agentId),
        listModelProviders(workspace.id).catch(() => []),
        listToolSkillAssets(workspace.id).catch(() => []),
      ])
      setAgent(nextAgent)
      setVersions(nextVersions)
      setModelProviders(Array.isArray(providerAssets) ? providerAssets : [])
      setToolSkillAssets(Array.isArray(workspaceAssets) ? workspaceAssets : [])
      const effectiveRuntimeManifest = hasPythonPackageRuntime(nextAgent.runtimeManifest)
        ? nextAgent.runtimeManifest
        : nextVersions.find((version) => hasPythonPackageRuntime(version.snapshot.runtimeManifest))
          ?.snapshot.runtimeManifest ?? nextAgent.runtimeManifest ?? {}
      setForm({
        name: nextAgent.name,
        role: nextAgent.role,
        owner: nextAgent.owner,
        model: nextAgent.model,
        modelProviderId: nextAgent.modelProviderId,
        modelProvider: nextAgent.modelProvider,
        modelBaseUrl: nextAgent.modelBaseUrl,
        temperature: nextAgent.temperature,
        maxOutputTokens: nextAgent.maxOutputTokens,
        systemPrompt: nextAgent.systemPrompt,
        tools: nextAgent.tools,
        skills: nextAgent.skills,
        runtimeManifest: effectiveRuntimeManifest,
      })
      setToolsText(joinValues(nextAgent.tools))
      setSkillsText(joinValues(nextAgent.skills))
      setTemperatureText(String(nextAgent.temperature))
      setMaxOutputTokensText(String(nextAgent.maxOutputTokens))
      setPackageDraft(packageDraftFromManifest(effectiveRuntimeManifest))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Agent 加载失败')
    }
  }, [agentId, workspace.id])

  useEffect(() => {
    void load()
  }, [load])

  function updateField(field: keyof UpdateAgentInput, value: string) {
    setForm((current) => current ? { ...current, [field]: value } : current)
    setFeedback('')
  }

  function updateRuntimeManifest(runtimeManifest: AgentRuntimeManifest) {
    setForm((current) => {
      if (!current) return current
      return {
        ...current,
        runtimeManifest,
      }
    })
    setFeedback('')
  }

  function importPythonPackage() {
    setRuntimeError('')
    setRuntimeFeedback('')
    const packageName = packageDraft.packageName.trim()
    const packageVersion = packageDraft.packageVersion.trim()
    const entrypoint = packageDraft.entrypoint.trim()
    if (!packageName || !packageVersion || !entrypoint) {
      setRuntimeError('Package 名称、版本和 EntryPoint 必填')
      return
    }
    updateRuntimeManifest({
      runtime: 'langchain',
      sourceType: 'python_package',
      packageName,
      packageVersion,
      entrypoint,
      packageHash: packageDraft.packageHash.trim() || undefined,
    })
    setRuntimeFeedback('Python Package 元数据已导入草稿')
  }

  function selectModelProvider(providerId: string) {
    setForm((current) => {
      if (!current) return current
      const selected = modelProviders.find((provider) => provider.id === providerId)
      if (!selected) {
        return { ...current, modelProviderId: null }
      }
      return {
        ...current,
        modelProviderId: selected.id,
        modelProvider: selected.providerType,
        modelBaseUrl: selected.baseUrl,
        model: selected.defaultModel,
      }
    })
    setFeedback('')
  }

  function updateAssetBinding(assetType: 'tool' | 'skill', assetName: string, checked: boolean) {
    if (assetType === 'tool') {
      setToolsText((current) => toggleValue(current, assetName, checked))
    } else {
      setSkillsText((current) => toggleValue(current, assetName, checked))
    }
    setFeedback('')
  }

  function buildAgentUpdateInput(formInput: UpdateAgentInput): UpdateAgentInput {
    return {
      ...formInput,
      temperature: Number(temperatureText),
      maxOutputTokens: Number(maxOutputTokensText),
      tools: splitValues(toolsText),
      skills: splitValues(skillsText),
      runtimeManifest: formInput.runtimeManifest ?? {},
    }
  }

  async function saveDraft() {
    if (!form) return
    setIsBusy(true)
    setError('')
    try {
      const saved = await updateAgent(workspace.id, agentId, {
        ...buildAgentUpdateInput(form),
      })
      setAgent(saved)
      setFeedback('草稿已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '草稿保存失败')
    } finally {
      setIsBusy(false)
    }
  }

  function openPublishNoteDialog() {
    setPublishNote('')
    setPublishNoteError('')
    setShowPublishNote(true)
    setError('')
  }

  async function publish(note: string) {
    const trimmedNote = note.trim()
    setIsBusy(true)
    setError('')
    try {
      if (form) {
        await updateAgent(workspace.id, agentId, {
          ...buildAgentUpdateInput(form),
        })
      }
      const version = await publishAgent(workspace.id, agentId, { note: trimmedNote })
      setVersions((current) => [version, ...current])
      setAgent((current) => current ? { ...current, version: version.version, status: '在线' } : current)
      setFeedback(`${version.version} 已发布`)
      setShowPublishNote(false)
      setPublishNote('')
      setPublishNoteError('')
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Agent 发布失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function confirmPublishWithNote() {
    const trimmedNote = publishNote.trim()
    if (!trimmedNote) {
      setPublishNoteError('请填写发布备注')
      return
    }
    await publish(trimmedNote)
  }

  async function deactivate() {
    setIsBusy(true)
    setError('')
    try {
      setAgent(await deactivateAgent(workspace.id, agentId))
      setFeedback('Agent 已停用')
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : 'Agent 停用失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function activate() {
    setIsBusy(true)
    setError('')
    try {
      setAgent(await activateAgent(workspace.id, agentId))
      setFeedback('Agent 已启用')
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : 'Agent 启用失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function testRun() {
    const input = runInput.trim()
    if (!input) {
      setError('请输入测试任务')
      return
    }
    setIsBusy(true)
    setError('')
    setRunResult(null)
    try {
      const result = await runAgent(workspace.id, agentId, {
        input,
        version: agent?.version,
      })
      setRunResult(result)
      setFeedback('测试运行已完成')
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Agent 运行失败')
    } finally {
      setIsBusy(false)
    }
  }

  if (error && !agent) {
    return <div className="panel table-state error" role="alert">{error}</div>
  }
  if (!agent || !form) {
    return <div className="panel table-state">正在加载 Agent 详情…</div>
  }

  const disabled = displayStatus(agent.status) === '已停用'
  const toolAssets = toolSkillAssets.filter((asset) => asset.assetType === 'tool')
  const skillAssets = toolSkillAssets.filter((asset) => asset.assetType === 'skill')
  const selectedTools = splitValues(toolsText)
  const selectedSkills = splitValues(skillsText)
  const runtimeManifest = form.runtimeManifest ?? {}

  return (
    <div className="page-stack asset-detail-page">
      <section className="asset-detail-toolbar">
        <div>
          <Link className="back-link" to={workspacePath('agents')}><ArrowLeft size={15} />返回 Agent 资产</Link>
          <div className="asset-title-line">
            <div className="asset-title-copy">
              <h2>{agent.name}</h2>
              <StatusBadge status={agent.status} />
            </div>
          </div>
        </div>
        <div className="asset-actions">
          <button className="button ghost" disabled={disabled || isBusy} onClick={() => void saveDraft()}>
            <Save size={15} />保存草稿
          </button>
          <button className="button ghost" disabled={disabled || isBusy} onClick={openPublishNoteDialog}>
            <PackageCheck size={15} />发布新版本
          </button>
          {disabled ? (
            <button className="button ghost" disabled={isBusy} onClick={() => void activate()}>
              <ShieldCheck size={15} />启用 Agent
            </button>
          ) : (
            <button className="button ghost danger-action" disabled={isBusy} onClick={() => void deactivate()}>
              <ShieldOff size={15} />停用 Agent
            </button>
          )}
        </div>
      </section>

      {(feedback || error) && (
        <div className={`inline-feedback ${error ? 'error' : ''}`} role="status">
          {error ? <ShieldOff size={15} /> : <Check size={15} />}
          {error || feedback}
        </div>
      )}

      <div className="asset-detail-grid">
        <section className="panel asset-editor">
          <header className="panel-header">
            <div><span className="section-kicker">可编辑草稿</span><h3>能力定义</h3></div>
            <span className="draft-indicator"><i />{disabled ? '只读' : '草稿'}</span>
          </header>
          <div className="asset-form-grid">
            <label className="form-field"><span>名称</span><input disabled={disabled} value={form.name} onChange={(event) => updateField('name', event.target.value)} /></label>
            <label className="form-field"><span>负责人</span><input disabled={disabled} value={form.owner} onChange={(event) => updateField('owner', event.target.value)} /></label>
            <label className="form-field full"><span>职责</span><textarea disabled={disabled} rows={3} value={form.role} onChange={(event) => updateField('role', event.target.value)} /></label>
            <label className="form-field"><span>模型</span><input disabled={disabled} value={form.model} onChange={(event) => updateField('model', event.target.value)} /></label>
            <label className="form-field"><span>当前发布版本</span><input readOnly value={agent.version} /></label>
            <section className="runtime-manifest-card full" aria-label="Runtime / Python Package">
              <header>
                <div>
                  <span className="section-kicker">Runtime / Python Package</span>
                  <h4>{runtimeTitle(runtimeManifest)}</h4>
                </div>
                <div className="runtime-header-actions">
                  <button className="button ghost" disabled={disabled} type="button" onClick={importPythonPackage}>
                    <Package size={15} />导入 Python Package
                  </button>
                </div>
              </header>
              <p className="runtime-package-note">
                Python Package 只声明 Agent 代码入口：包名、版本、入口函数与内容指纹。模型、温度和最大输出等运行参数在下方 Runtime 配置中维护。
              </p>
              <div className="runtime-linkage-grid">
                <div>
                  <span>ARC 生效配置</span>
                  <strong>{form.model} · temp {temperatureText} · max {maxOutputTokensText}</strong>
                </div>
              </div>
              <div className="runtime-import-grid">
                <div className="runtime-package-fields">
                  <label className="form-field"><span>Package 名称</span><input disabled={disabled} value={packageDraft.packageName} onChange={(event) => setPackageDraft((current) => ({ ...current, packageName: event.target.value }))} /></label>
                  <label className="form-field"><span>Package 版本</span><input disabled={disabled} value={packageDraft.packageVersion} onChange={(event) => setPackageDraft((current) => ({ ...current, packageVersion: event.target.value }))} /></label>
                  <label className="form-field"><span>Package EntryPoint</span><input disabled={disabled} value={packageDraft.entrypoint} onChange={(event) => setPackageDraft((current) => ({ ...current, entrypoint: event.target.value }))} /></label>
                  <label className="form-field"><span>Package Hash</span><input disabled={disabled} value={packageDraft.packageHash} onChange={(event) => setPackageDraft((current) => ({ ...current, packageHash: event.target.value }))} /></label>
                </div>
              </div>
              {(runtimeFeedback || runtimeError) && (
                <p className={`runtime-manifest-feedback ${runtimeError ? 'error' : ''}`}>
                  {runtimeError || runtimeFeedback}
                </p>
              )}
            </section>
            <div className="form-section-heading"><span>RUNTIME</span><strong>运行配置</strong></div>
            <label className="form-field">
              <span>模型资产</span>
              <select
                disabled={disabled}
                value={form.modelProviderId ?? ''}
                onChange={(event) => selectModelProvider(event.target.value)}
              >
                <option value="">未绑定（手动配置）</option>
                {modelProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field"><span>Base URL</span><input disabled={disabled} value={form.modelBaseUrl ?? ''} onChange={(event) => updateField('modelBaseUrl', event.target.value)} placeholder="https://api.deepseek.com" /></label>
            <label className="form-field"><span>温度</span><input disabled={disabled} inputMode="decimal" value={temperatureText} onChange={(event) => setTemperatureText(event.target.value)} /></label>
            <label className="form-field"><span>最大输出 Tokens</span><input disabled={disabled} inputMode="numeric" value={maxOutputTokensText} onChange={(event) => setMaxOutputTokensText(event.target.value)} /></label>
            <label className="form-field full prompt-field">
              <span><Sparkles size={14} />System Prompt</span>
              <textarea disabled={disabled} rows={10} value={form.systemPrompt} onChange={(event) => updateField('systemPrompt', event.target.value)} placeholder="定义 Agent 的职责、约束、输出格式和质量要求" />
            </label>
            <div className="form-field full asset-picker">
              <span>可用 Tool 资产</span>
              <div className="asset-picker-list">
                {toolAssets.length === 0 && <p>暂无 Tool 资产。</p>}
                {toolAssets.map((asset) => {
                  const assetDisabled = asset.status === 'disabled'
                  return (
                    <label className={`asset-picker-option ${assetDisabled ? 'disabled' : ''}`} key={asset.id}>
                      <input
                        aria-label={`绑定 Tool ${asset.name}`}
                        checked={selectedTools.includes(asset.name)}
                        disabled={disabled || assetDisabled}
                        onChange={(event) => updateAssetBinding('tool', asset.name, event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{asset.name}</strong>
                        <small>{assetDisabled ? '已停用' : `${asset.adapterType} · active`}</small>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
            <label className="form-field full"><span>Tools</span><input disabled={disabled} value={toolsText} onChange={(event) => setToolsText(event.target.value)} placeholder="Web Search, 飞书知识库" /></label>
            <div className="form-field full asset-picker">
              <span>可用 Skill 资产</span>
              <div className="asset-picker-list">
                {skillAssets.length === 0 && <p>暂无 Skill 资产。</p>}
                {skillAssets.map((asset) => {
                  const assetDisabled = asset.status === 'disabled'
                  return (
                    <label className={`asset-picker-option ${assetDisabled ? 'disabled' : ''}`} key={asset.id}>
                      <input
                        aria-label={`绑定 Skill ${asset.name}`}
                        checked={selectedSkills.includes(asset.name)}
                        disabled={disabled || assetDisabled}
                        onChange={(event) => updateAssetBinding('skill', asset.name, event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{asset.name}</strong>
                        <small>{assetDisabled ? '已停用' : `${asset.adapterType} · active`}</small>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
            <label className="form-field full"><span>Skills</span><input disabled={disabled} value={skillsText} onChange={(event) => setSkillsText(event.target.value)} placeholder="竞品分析, 引用核验" /></label>
          </div>
        </section>

        <aside className="panel version-panel">
          <header className="panel-header">
            <div><span className="section-kicker">不可变快照</span><h3>版本管理</h3></div>
            <History size={17} />
          </header>
          <div className="version-list">
            {versions.length === 0 && <div className="version-empty">尚未发布版本</div>}
            {versions.map((version) => (
              <article className="version-item" key={version.id}>
                <div><strong>{version.version}</strong><span>已发布</span></div>
                <p>{version.snapshot.name}</p>
                <p className={`version-note ${version.note?.trim() ? '' : 'empty'}`}>
                  发布备注：{version.note?.trim() || '未填写'}
                </p>
                <small>{new Date(version.createdAt).toLocaleString('zh-CN')}</small>
              </article>
            ))}
          </div>
        </aside>
      </div>

      <section className="panel agent-test-panel">
        <header className="panel-header">
          <div><span className="section-kicker">已发布版本</span><h3>测试运行</h3></div>
          <span className="draft-indicator"><i />{agent.version}</span>
        </header>
        <label className="form-field">
          <span>测试输入</span>
          <textarea
            rows={4}
            value={runInput}
            onChange={(event) => setRunInput(event.target.value)}
            placeholder="输入一条真实任务，运行结果会写入运行中心"
          />
        </label>
        <div className="agent-test-actions">
          <button
            className="button primary"
            disabled={disabled || isBusy || versions.length === 0}
            onClick={() => void testRun()}
          >
            <Play size={15} />运行 Agent
          </button>
          {versions.length === 0 && <small>请先发布一个 Agent 版本。</small>}
        </div>
        {runResult && (
          <div className="agent-test-result">
            <div className="run-kpis">
              <div><span>状态</span><strong>{runResult.status}</strong></div>
              <div><span>Token</span><strong>{runResult.totalTokens}</strong></div>
              <div><span>质量得分</span><strong>{runResult.score ?? '待评估'}</strong></div>
              <div><span>耗时</span><strong>{runResult.durationMs} ms</strong></div>
            </div>
            <div className="artifact-preview"><p>{runResult.output || runResult.error}</p></div>
          </div>
        )}
      </section>

      {showPublishNote && (
        <div className="dialog-backdrop">
          <section className="agent-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-publish-note-title">
            <header>
              <div>
                <p className="eyebrow">VERSION NOTE</p>
                <h2 id="agent-publish-note-title">发布版本备注</h2>
              </div>
              <button className="icon-button quiet" title="关闭" onClick={() => setShowPublishNote(false)}><X size={18} /></button>
            </header>
            <label className="form-field">
              <span>备注</span>
              <textarea
                aria-label="发布备注"
                rows={5}
                maxLength={500}
                value={publishNote}
                onChange={(event) => {
                  setPublishNote(event.target.value)
                  if (publishNoteError) setPublishNoteError('')
                }}
                placeholder="说明本次 Agent 能力、工具、模型或提示词的变化"
              />
            </label>
            {publishNoteError && <p className="danger-text">{publishNoteError}</p>}
            <div className="dialog-actions">
              <button className="button secondary" disabled={isBusy} onClick={() => setShowPublishNote(false)}>取消</button>
              <button className="button primary" disabled={isBusy} onClick={() => void confirmPublishWithNote()}>
                <PackageCheck size={14} />确认发布版本
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
