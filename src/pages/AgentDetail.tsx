import {
  ArrowLeft,
  Bot,
  Check,
  FileJson,
  History,
  Package,
  PackageCheck,
  Play,
  Save,
  ShieldOff,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  deactivateAgent,
  getAgent,
  listAgentVersions,
  publishAgent,
  updateAgent,
  type UpdateAgentInput,
} from '../api/agents'
import { runAgent } from '../api/execution'
import { StatusBadge } from '../components/StatusBadge'
import type { Agent, AgentRuntimeManifest, AgentVersion, ExecutionRun } from '../types'

function joinValues(values: string[]) {
  return values.join(', ')
}

function splitValues(value: string) {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : undefined
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean)
    : undefined
}

function formatJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2)
}

function runtimeSourceLabel(manifest: AgentRuntimeManifest) {
  if (manifest.sourceType === 'python_package') return 'Python Package'
  if (manifest.sourceType === 'manifest') return 'Manifest JSON'
  return '未注册'
}

function runtimeTitle(manifest: AgentRuntimeManifest) {
  if (manifest.packageName && manifest.packageVersion) {
    return `${manifest.packageName}==${manifest.packageVersion}`
  }
  return manifest.entrypoint || manifest.repo || '尚未导入运行入口'
}

function packageDraftFromManifest(manifest: AgentRuntimeManifest) {
  return {
    packageName: manifest.packageName ?? '',
    packageVersion: manifest.packageVersion ?? '',
    entrypoint: manifest.entrypoint ?? '',
    packageSource: manifest.packageSource ?? '',
    packageHash: manifest.packageHash ?? '',
  }
}

export function AgentDetail() {
  const { agentId = '' } = useParams()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [versions, setVersions] = useState<AgentVersion[]>([])
  const [form, setForm] = useState<UpdateAgentInput | null>(null)
  const [toolsText, setToolsText] = useState('')
  const [skillsText, setSkillsText] = useState('')
  const [manifestText, setManifestText] = useState('')
  const [packageDraft, setPackageDraft] = useState(packageDraftFromManifest({}))
  const [runtimeFeedback, setRuntimeFeedback] = useState('')
  const [runtimeError, setRuntimeError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [runInput, setRunInput] = useState('')
  const [runResult, setRunResult] = useState<ExecutionRun | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextAgent, nextVersions] = await Promise.all([
        getAgent(agentId),
        listAgentVersions(agentId),
      ])
      setAgent(nextAgent)
      setVersions(nextVersions)
      setForm({
        name: nextAgent.name,
        role: nextAgent.role,
        owner: nextAgent.owner,
        model: nextAgent.model,
        systemPrompt: nextAgent.systemPrompt,
        tools: nextAgent.tools,
        skills: nextAgent.skills,
        runtimeManifest: nextAgent.runtimeManifest ?? {},
      })
      setToolsText(joinValues(nextAgent.tools))
      setSkillsText(joinValues(nextAgent.skills))
      setPackageDraft(packageDraftFromManifest(nextAgent.runtimeManifest ?? {}))
      setManifestText(
        nextAgent.runtimeManifest?.sourceType === 'manifest' && nextAgent.runtimeManifest.rawManifest
          ? formatJson(nextAgent.runtimeManifest.rawManifest)
          : '',
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Agent 加载失败')
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  function updateField(field: keyof UpdateAgentInput, value: string) {
    setForm((current) => current ? { ...current, [field]: value } : current)
    setFeedback('')
  }

  function updateRuntimeManifest(runtimeManifest: AgentRuntimeManifest) {
    setForm((current) => current ? { ...current, runtimeManifest } : current)
    setFeedback('')
  }

  function importManifest() {
    setRuntimeError('')
    setRuntimeFeedback('')
    try {
      const parsed: unknown = JSON.parse(manifestText)
      if (!isRecord(parsed)) {
        setRuntimeError('Manifest 必须是 JSON object')
        return
      }
      const entrypoint = stringValue(parsed.entrypoint)
      if (!entrypoint) {
        setRuntimeError('Manifest 需要包含 entrypoint')
        return
      }
      const runtimeManifest: AgentRuntimeManifest = {
        runtime: stringValue(parsed.runtime) || 'langchain',
        sourceType: 'manifest',
        repo: stringValue(parsed.repo) || stringValue(parsed.repository) || undefined,
        gitSha: stringValue(parsed.gitSha) || stringValue(parsed.git_sha) || undefined,
        manifestPath: stringValue(parsed.manifestPath) || stringValue(parsed.path) || undefined,
        entrypoint,
        inputSchema: recordValue(parsed.inputSchema),
        outputSchema: recordValue(parsed.outputSchema),
        tools: stringArray(parsed.tools),
        rawManifest: parsed,
      }
      updateRuntimeManifest(runtimeManifest)
      setRuntimeFeedback('Manifest 已导入草稿')
    } catch {
      setRuntimeError('Manifest JSON 格式不正确')
    }
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
      packageSource: packageDraft.packageSource.trim() || undefined,
      packageHash: packageDraft.packageHash.trim() || undefined,
    })
    setRuntimeFeedback('Python Package 元数据已导入草稿')
  }

  async function saveDraft() {
    if (!form) return
    setIsBusy(true)
    setError('')
    try {
      const saved = await updateAgent(agentId, {
        ...form,
        tools: splitValues(toolsText),
        skills: splitValues(skillsText),
        runtimeManifest: form.runtimeManifest ?? {},
      })
      setAgent(saved)
      setFeedback('草稿已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '草稿保存失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function publish() {
    setIsBusy(true)
    setError('')
    try {
      if (form) {
        await updateAgent(agentId, {
          ...form,
          tools: splitValues(toolsText),
          skills: splitValues(skillsText),
          runtimeManifest: form.runtimeManifest ?? {},
        })
      }
      const version = await publishAgent(agentId)
      setVersions((current) => [version, ...current])
      setAgent((current) => current ? { ...current, version: version.version, status: '在线' } : current)
      setFeedback(`${version.version} 已发布`)
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Agent 发布失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function deactivate() {
    setIsBusy(true)
    setError('')
    try {
      setAgent(await deactivateAgent(agentId))
      setFeedback('Agent 已停用')
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : 'Agent 停用失败')
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
      const result = await runAgent(agentId, {
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

  const disabled = agent.status === '已停用'
  const runtimeManifest = form.runtimeManifest ?? {}

  return (
    <div className="page-stack asset-detail-page">
      <section className="asset-detail-toolbar">
        <div>
          <Link className="back-link" to="/agents"><ArrowLeft size={15} />返回 Agent 资产</Link>
          <div className="asset-title-line">
            <span className="agent-symbol large"><Bot size={22} /></span>
            <div>
              <p className="section-kicker">AGENT DRAFT</p>
              <h2>{agent.name}</h2>
            </div>
            <StatusBadge status={agent.status} />
          </div>
        </div>
        <div className="asset-actions">
          <button className="button secondary" disabled={disabled || isBusy} onClick={() => void saveDraft()}>
            <Save size={15} />保存草稿
          </button>
          <button className="button primary" disabled={disabled || isBusy} onClick={() => void publish()}>
            <PackageCheck size={15} />发布新版本
          </button>
          <button className="button danger" disabled={disabled || isBusy} onClick={() => void deactivate()}>
            <ShieldOff size={15} />停用 Agent
          </button>
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
            <section className="runtime-manifest-card full" aria-label="Runtime / Manifest">
              <header>
                <div>
                  <span className="section-kicker">Runtime / Manifest</span>
                  <h4>{runtimeTitle(runtimeManifest)}</h4>
                </div>
                <span className="runtime-source-pill">{runtimeSourceLabel(runtimeManifest)}</span>
              </header>
              <div className="runtime-manifest-summary">
                <div><span>Runtime</span><strong>{runtimeManifest.runtime || 'langchain'}</strong></div>
                <div><span>EntryPoint</span><strong>{runtimeManifest.entrypoint || '未注册'}</strong></div>
                <div><span>Package</span><strong>{runtimeManifest.packageName ? `${runtimeManifest.packageName}==${runtimeManifest.packageVersion || '未标注'}` : '无'}</strong></div>
                <div><span>Repo</span><strong>{runtimeManifest.repo || '无'}</strong></div>
              </div>
              <div className="runtime-import-grid">
                <label className="form-field runtime-manifest-json">
                  <span><FileJson size={14} />Manifest JSON</span>
                  <textarea
                    aria-label="Manifest JSON"
                    disabled={disabled}
                    rows={8}
                    value={manifestText}
                    onChange={(event) => setManifestText(event.target.value)}
                    placeholder={'{\n  "runtime": "langchain",\n  "repo": "git@example.com:team/agents.git",\n  "entrypoint": "agents.research:create_agent"\n}'}
                  />
                </label>
                <div className="runtime-import-actions">
                  <button className="button secondary" disabled={disabled || !manifestText.trim()} type="button" onClick={importManifest}>
                    <FileJson size={15} />导入 Manifest
                  </button>
                </div>
                <div className="runtime-package-fields">
                  <label className="form-field"><span>Package 名称</span><input disabled={disabled} value={packageDraft.packageName} onChange={(event) => setPackageDraft((current) => ({ ...current, packageName: event.target.value }))} /></label>
                  <label className="form-field"><span>Package 版本</span><input disabled={disabled} value={packageDraft.packageVersion} onChange={(event) => setPackageDraft((current) => ({ ...current, packageVersion: event.target.value }))} /></label>
                  <label className="form-field"><span>Package EntryPoint</span><input disabled={disabled} value={packageDraft.entrypoint} onChange={(event) => setPackageDraft((current) => ({ ...current, entrypoint: event.target.value }))} /></label>
                  <label className="form-field"><span>Package 来源</span><input disabled={disabled} value={packageDraft.packageSource} onChange={(event) => setPackageDraft((current) => ({ ...current, packageSource: event.target.value }))} /></label>
                  <label className="form-field"><span>Package Hash</span><input disabled={disabled} value={packageDraft.packageHash} onChange={(event) => setPackageDraft((current) => ({ ...current, packageHash: event.target.value }))} /></label>
                </div>
                <div className="runtime-import-actions">
                  <button className="button secondary" disabled={disabled} type="button" onClick={importPythonPackage}>
                    <Package size={15} />导入 Python Package
                  </button>
                </div>
              </div>
              {(runtimeFeedback || runtimeError) && (
                <p className={`runtime-manifest-feedback ${runtimeError ? 'error' : ''}`}>
                  {runtimeError || runtimeFeedback}
                </p>
              )}
            </section>
            <label className="form-field full prompt-field">
              <span><Sparkles size={14} />System Prompt</span>
              <textarea disabled={disabled} rows={10} value={form.systemPrompt} onChange={(event) => updateField('systemPrompt', event.target.value)} placeholder="定义 Agent 的职责、约束、输出格式和质量要求" />
            </label>
            <label className="form-field full"><span>Tools</span><input disabled={disabled} value={toolsText} onChange={(event) => setToolsText(event.target.value)} placeholder="Web Search, 飞书知识库" /></label>
            <label className="form-field full"><span>Skills</span><input disabled={disabled} value={skillsText} onChange={(event) => setSkillsText(event.target.value)} placeholder="竞品分析, 引用核验" /></label>
          </div>
        </section>

        <aside className="panel version-panel">
          <header className="panel-header">
            <div><span className="section-kicker">不可变快照</span><h3>版本历史</h3></div>
            <History size={17} />
          </header>
          <div className="version-list">
            {versions.length === 0 && <div className="version-empty">尚未发布版本</div>}
            {versions.map((version) => (
              <article className="version-item" key={version.id}>
                <div><strong>{version.version}</strong><span>已发布</span></div>
                <p>{version.snapshot.name}</p>
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
    </div>
  )
}
