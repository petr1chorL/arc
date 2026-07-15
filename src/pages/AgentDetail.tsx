import {
  ArrowLeft,
  Check,
  History,
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

const REMOTE_AGENT_PROTOCOL_VERSION = 'arc-agent-v1'

type AgentExecutionMode = 'builtin' | 'remote_api' | 'legacy_unsupported'

interface RemoteAgentDraft {
  endpointUrl: string
  secretRef: string
  timeoutSeconds: string
}

function hasRemoteAgentRuntime(manifest?: AgentRuntimeManifest) {
  return manifest?.runtime === 'remote_http' && manifest.sourceType === 'remote_api'
}

function hasLegacyPythonPackageRuntime(manifest?: AgentRuntimeManifest) {
  return Boolean(
    manifest
    && (manifest.sourceType === 'python_package' || manifest.runtime === 'langchain'),
  )
}

function isIpLiteral(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, '')
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(':')
}

function remoteDraftFromManifest(manifest?: AgentRuntimeManifest): RemoteAgentDraft {
  return {
    endpointUrl: hasRemoteAgentRuntime(manifest) ? manifest?.endpointUrl ?? '' : '',
    secretRef: hasRemoteAgentRuntime(manifest) ? manifest?.secretRef ?? '' : '',
    timeoutSeconds: String(
      hasRemoteAgentRuntime(manifest) ? manifest?.timeoutSeconds ?? 30 : 30,
    ),
  }
}

function validateRemoteAgentDraft(draft: RemoteAgentDraft) {
  const endpointUrl = draft.endpointUrl.trim()
  let parsedUrl: URL
  try {
    parsedUrl = new URL(endpointUrl)
  } catch {
    return '请输入完整的 HTTPS Agent API 地址'
  }
  if (parsedUrl.protocol !== 'https:') {
    return '请输入完整的 HTTPS Agent API 地址'
  }
  if (
    !parsedUrl.hostname
    || isIpLiteral(parsedUrl.hostname)
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.search
    || parsedUrl.hash
    || (parsedUrl.port && parsedUrl.port !== '443')
  ) {
    return 'Agent API 地址必须使用域名和 443 端口，且不能包含凭证、查询参数或片段'
  }
  if (!/^[A-Z_][A-Z0-9_]*$/.test(draft.secretRef.trim())) {
    return 'Secret Ref 只能填写后端环境变量名'
  }
  const timeoutSeconds = Number(draft.timeoutSeconds)
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60) {
    return '请求超时必须是 1–60 秒的整数'
  }
  return ''
}

function remoteManifestFromDraft(draft: RemoteAgentDraft): AgentRuntimeManifest {
  return {
    runtime: 'remote_http',
    sourceType: 'remote_api',
    protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
    endpointUrl: draft.endpointUrl.trim(),
    secretRef: draft.secretRef.trim(),
    timeoutSeconds: Number(draft.timeoutSeconds),
  }
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
  const [executionMode, setExecutionMode] = useState<AgentExecutionMode>('builtin')
  const [remoteDraft, setRemoteDraft] = useState(remoteDraftFromManifest())
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
      const runtimeManifest = nextAgent.runtimeManifest ?? {}
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
        runtimeManifest,
      })
      setToolsText(joinValues(nextAgent.tools))
      setSkillsText(joinValues(nextAgent.skills))
      setTemperatureText(String(nextAgent.temperature))
      setMaxOutputTokensText(String(nextAgent.maxOutputTokens))
      setExecutionMode(
        hasRemoteAgentRuntime(runtimeManifest)
          ? 'remote_api'
          : hasLegacyPythonPackageRuntime(runtimeManifest) ? 'legacy_unsupported' : 'builtin',
      )
      setRemoteDraft(remoteDraftFromManifest(runtimeManifest))
      setRuntimeError('')
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

  function selectExecutionMode(value: AgentExecutionMode) {
    if (value === 'legacy_unsupported') return
    setExecutionMode(value)
    setRuntimeError('')
    setFeedback('')
    if (value === 'builtin') {
      setForm((current) => current ? { ...current, runtimeManifest: {} } : current)
    }
  }

  function updateRemoteDraft(field: keyof RemoteAgentDraft, value: string) {
    setRemoteDraft((current) => ({ ...current, [field]: value }))
    setRuntimeError('')
    setFeedback('')
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

  function executionConfigurationError() {
    if (executionMode === 'legacy_unsupported') {
      return '请先明确选择平台托管或远程 Agent API，再保存或发布新版本'
    }
    return executionMode === 'remote_api' ? validateRemoteAgentDraft(remoteDraft) : ''
  }

  function buildAgentUpdateInput(formInput: UpdateAgentInput): UpdateAgentInput {
    return {
      ...formInput,
      temperature: Number(temperatureText),
      maxOutputTokens: Number(maxOutputTokensText),
      tools: splitValues(toolsText),
      skills: splitValues(skillsText),
      runtimeManifest: executionMode === 'remote_api'
        ? remoteManifestFromDraft(remoteDraft)
        : executionMode === 'builtin'
          ? {}
          : formInput.runtimeManifest,
    }
  }

  async function saveDraft() {
    if (!form) return
    const validationError = executionConfigurationError()
    if (validationError) {
      setRuntimeError(validationError)
      setError('')
      return
    }
    setRuntimeError('')
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
    const validationError = executionConfigurationError()
    if (validationError) {
      setRuntimeError(validationError)
      setError('')
      return
    }
    setRuntimeError('')
    setPublishNote('')
    setPublishNoteError('')
    setShowPublishNote(true)
    setError('')
  }

  async function publish(note: string) {
    const trimmedNote = note.trim()
    const validationError = executionConfigurationError()
    if (validationError) {
      setRuntimeError(validationError)
      setError('')
      return
    }
    setRuntimeError('')
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
    const publishedVersion = versions.find((version) => version.version === agent?.version)
    if (hasLegacyPythonPackageRuntime(publishedVersion?.snapshot.runtimeManifest)) {
      setError('该版本使用已停止支持的运行方式，请配置远程 Agent API 并发布新版本')
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
  const publishedRuntimeManifest = versions.find((version) => version.version === agent.version)
    ?.snapshot.runtimeManifest
  const legacyPackageExecutionBlocked = hasLegacyPythonPackageRuntime(publishedRuntimeManifest)
  const legacyRuntimeRequiresMigration = legacyPackageExecutionBlocked
    || hasLegacyPythonPackageRuntime(form.runtimeManifest)

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
            <label className="form-field"><span>模型</span><input disabled={disabled || executionMode !== 'builtin'} value={form.model} onChange={(event) => updateField('model', event.target.value)} /></label>
            <label className="form-field"><span>当前发布版本</span><input readOnly value={agent.version} /></label>
            <section className="runtime-manifest-card full" aria-label="Agent 执行方式">
              <header>
                <div>
                  <span className="section-kicker">EXECUTION</span>
                  <h4>{executionMode === 'remote_api'
                    ? '远程 Agent API'
                    : executionMode === 'legacy_unsupported'
                      ? '旧 Python Package（需迁移）'
                      : '平台托管（ModelGateway）'}</h4>
                </div>
              </header>
              <p className="runtime-source-note">
                <span>远程 Agent API 由 ARC.ONE 后端调用，浏览器不会直接请求目标地址，也不会保存密钥值。</span>
                <span>执行配置需发布为新版本后才参与运行。</span>
              </p>
              <div className="runtime-import-grid">
                <div className="runtime-source-fields">
                  <label className="form-field">
                    <span>执行方式</span>
                    <select
                      disabled={disabled}
                      value={executionMode}
                      onChange={(event) => selectExecutionMode(event.target.value as AgentExecutionMode)}
                    >
                      {executionMode === 'legacy_unsupported' && (
                        <option value="legacy_unsupported" disabled>旧 Python Package（需迁移）</option>
                      )}
                      <option value="builtin">平台托管（ModelGateway）</option>
                      <option value="remote_api">远程 Agent API</option>
                    </select>
                  </label>
                  {executionMode === 'remote_api' ? (
                    <>
                      <label className="form-field full">
                        <span>Agent API 地址</span>
                        <input
                          disabled={disabled}
                          value={remoteDraft.endpointUrl}
                          onChange={(event) => updateRemoteDraft('endpointUrl', event.target.value)}
                          placeholder="https://agent.example.com/v1/invoke"
                        />
                      </label>
                      <label className="form-field">
                        <span>Secret Ref（环境变量名）</span>
                        <input
                          disabled={disabled}
                          value={remoteDraft.secretRef}
                          onChange={(event) => updateRemoteDraft('secretRef', event.target.value)}
                          placeholder="RESEARCH_AGENT_API_TOKEN"
                        />
                      </label>
                      <label className="form-field">
                        <span>请求超时（秒）</span>
                        <input
                          disabled={disabled}
                          min={1}
                          max={60}
                          step={1}
                          type="number"
                          value={remoteDraft.timeoutSeconds}
                          onChange={(event) => updateRemoteDraft('timeoutSeconds', event.target.value)}
                        />
                      </label>
                      <p className="runtime-mode-hint full">远程 API 模式下模型由目标服务管理，下方模型配置不参与执行。</p>
                    </>
                  ) : (
                    <div className="runtime-linkage-grid full">
                      <div>
                        <span>ARC 生效配置</span>
                        <strong>{form.model} · temp {temperatureText} · max {maxOutputTokensText}</strong>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {legacyRuntimeRequiresMigration && (
                <p className="runtime-manifest-feedback error">
                  该版本包含旧 Python Package 元数据，当前不可运行。请选择新的执行方式并发布新版本。
                </p>
              )}
              {runtimeError && (
                <p className="runtime-manifest-feedback error">{runtimeError}</p>
              )}
            </section>
            <div className="form-section-heading"><span>RUNTIME</span><strong>运行配置</strong></div>
            <label className="form-field">
              <span>模型资产</span>
              <select
                disabled={disabled || executionMode !== 'builtin'}
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
            <label className="form-field"><span>模型 Base URL</span><input disabled={disabled || executionMode !== 'builtin'} value={form.modelBaseUrl ?? ''} onChange={(event) => updateField('modelBaseUrl', event.target.value)} placeholder="https://api.deepseek.com" /></label>
            <label className="form-field"><span>温度</span><input disabled={disabled || executionMode !== 'builtin'} inputMode="decimal" value={temperatureText} onChange={(event) => setTemperatureText(event.target.value)} /></label>
            <label className="form-field"><span>最大输出 Tokens</span><input disabled={disabled || executionMode !== 'builtin'} inputMode="numeric" value={maxOutputTokensText} onChange={(event) => setMaxOutputTokensText(event.target.value)} /></label>
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
            disabled={disabled || isBusy || versions.length === 0 || legacyPackageExecutionBlocked}
            onClick={() => void testRun()}
          >
            <Play size={15} />运行 Agent
          </button>
          {versions.length === 0 && <small>请先发布一个 Agent 版本。</small>}
          {legacyPackageExecutionBlocked && <small>该历史版本使用已停止支持的运行方式，请配置远程 Agent API 并发布新版本。</small>}
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
