import { Check, KeyRound, PlugZap, Plus, ShieldOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  createModelProvider,
  deactivateModelProvider,
  getModelProviderImpact,
  getModelProviderAuditEvents,
  listModelProviders,
  testModelProviderConnection,
  updateModelProvider,
  type CreateModelProviderInput,
} from '../api/modelProviders'
import { useWorkspace } from '../auth/workspaceContextState'
import { isReferenceAssetMigration, referenceAssetMigrationNotice } from '../api/migrationCapabilities'
import type {
  ModelProvider,
  ModelProviderAuditEvent,
  ModelProviderConnectivity,
  ModelProviderImpact,
  ModelProviderType,
} from '../types'

const initialForm: CreateModelProviderInput = {
  name: '',
  providerType: 'openai-compatible',
  baseUrl: '',
  defaultModel: '',
  secretRef: '',
}

const modelSecretRefPattern = /^[A-Z_][A-Z0-9_]*$/

function isValidModelSecretRef(secretRef: string): boolean {
  return modelSecretRefPattern.test(secretRef.trim())
}

export function ModelProviders() {
  const migrationOnly = isReferenceAssetMigration()
  const { workspace } = useWorkspace()
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [form, setForm] = useState<CreateModelProviderInput>(initialForm)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [connectivityByProviderId, setConnectivityByProviderId] = useState<Record<string, ModelProviderConnectivity>>({})
  const [impactByProviderId, setImpactByProviderId] = useState<Record<string, ModelProviderImpact>>({})
  const [impactErrors, setImpactErrors] = useState<string[]>([])
  const [auditByProviderId, setAuditByProviderId] = useState<Partial<Record<string, ModelProviderAuditEvent[] | null>>>({})
  const [editingProviderId, setEditingProviderId] = useState('')
  const [editForm, setEditForm] = useState<CreateModelProviderInput>(initialForm)
  const [isBusy, setIsBusy] = useState(false)

  const loadProviderImpacts = useCallback(async (loadedProviders: ModelProvider[]) => {
    setImpactByProviderId({})
    setImpactErrors([])
    const failed: string[] = []
    const impacts = await Promise.all(loadedProviders.map(async (provider) => {
      try {
        return await getModelProviderImpact(workspace.id, provider.id)
      } catch {
        failed.push(provider.id)
        return undefined
      }
    }))
    setImpactByProviderId(Object.fromEntries(
      impacts
        .filter((impact): impact is ModelProviderImpact => Boolean(impact))
        .map((impact) => [impact.providerId, impact]),
    ))
    setImpactErrors(failed)
  }, [workspace.id])

  const loadProviderAudits = useCallback(async (targets: ModelProvider[]) => {
    setAuditByProviderId(current => ({ ...current, ...Object.fromEntries(targets.map(provider => [provider.id, undefined])) }))
    const entries = await Promise.all(targets.map(async provider => {
      try { return [provider.id, await getModelProviderAuditEvents(workspace.id, provider.id)] as const }
      catch { return [provider.id, null] as const }
    }))
    setAuditByProviderId(current => ({ ...current, ...Object.fromEntries(entries) }))
  }, [workspace.id])

  useEffect(() => {
    void listModelProviders(workspace.id)
      .then((loadedProviders) => {
        setProviders(loadedProviders)
        return Promise.all([loadProviderImpacts(loadedProviders), loadProviderAudits(loadedProviders)])
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '模型资产加载失败'))
  }, [loadProviderImpacts, loadProviderAudits, workspace.id])

  function updateField<TField extends keyof CreateModelProviderInput>(
    field: TField,
    value: CreateModelProviderInput[TField],
  ) {
    setForm((current) => ({ ...current, [field]: value }))
    setFeedback('')
    setError('')
  }

  async function createProvider() {
    setError('')
    const secretRef = form.secretRef.trim()
    if (!isValidModelSecretRef(secretRef)) {
      setError('Secret Ref 只能填写后端环境变量名')
      return
    }
    setIsBusy(true)
    try {
      const created = await createModelProvider(workspace.id, {
        ...form,
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        defaultModel: form.defaultModel.trim(),
        secretRef,
      })
      setProviders((current) => [created, ...current])
      await Promise.all([loadProviderImpacts([created, ...providers]), loadProviderAudits([created])])
      setForm(initialForm)
      setFeedback('模型资产已创建')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '模型资产创建失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function testConnection(provider: ModelProvider) {
    if (migrationOnly) return
    setIsBusy(true)
    setError('')
    try {
      const result = await testModelProviderConnection(workspace.id, provider.id)
      setConnectivityByProviderId((current) => ({ ...current, [provider.id]: result }))
      setFeedback(result.status === 'ready' ? '连接测试通过' : '连接测试完成，请查看卡片提示')
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : '连接测试失败')
    } finally {
      setIsBusy(false)
    }
  }

  function startEditing(provider: ModelProvider) {
    setEditingProviderId(provider.id)
    setEditForm({
      name: provider.name,
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      secretRef: provider.secretRef,
    })
    setFeedback('')
    setError('')
  }

  function updateEditField<TField extends keyof CreateModelProviderInput>(
    field: TField,
    value: CreateModelProviderInput[TField],
  ) {
    setEditForm((current) => ({ ...current, [field]: value }))
    setFeedback('')
    setError('')
  }

  async function saveProvider(provider: ModelProvider) {
    setError('')
    const secretRef = editForm.secretRef.trim()
    if (!isValidModelSecretRef(secretRef)) {
      setError('Secret Ref 只能填写后端环境变量名')
      return
    }
    setIsBusy(true)
    try {
      const updated = await updateModelProvider(workspace.id, provider.id, {
        ...editForm,
        name: editForm.name.trim(),
        baseUrl: editForm.baseUrl.trim(),
        defaultModel: editForm.defaultModel.trim(),
        secretRef,
      })
      setProviders((current) => current.map((item) => item.id === updated.id ? updated : item))
      await Promise.all([loadProviderImpacts(providers.map(item => item.id === updated.id ? updated : item)), loadProviderAudits([updated])])
      setEditingProviderId('')
      setFeedback('模型资产已更新')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '模型资产更新失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function deactivateProvider(provider: ModelProvider) {
    setIsBusy(true)
    setError('')
    try {
      const disabled = await deactivateModelProvider(workspace.id, provider.id)
      setProviders((current) => current.map((item) => item.id === disabled.id ? disabled : item))
      await loadProviderAudits([disabled])
      setFeedback('模型资产已停用')
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : '模型资产停用失败')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="page-stack model-providers-page">
      {migrationOnly && <p role="status">{referenceAssetMigrationNotice}</p>}
      <section className="panel model-provider-intro">
        <div>
          <p className="section-kicker">MODEL PROVIDERS</p>
          <h2>模型资产</h2>
          <p>统一维护模型 Base URL、默认模型和后端环境变量引用。浏览器不接收模型密钥。</p>
        </div>
        <div className="provider-secret-note">
          <KeyRound size={18} />
          <span>密钥只允许在后端环境变量中配置</span>
        </div>
      </section>

      {(feedback || error) && (
        <div className={`inline-feedback ${error ? 'error' : ''}`} role="status">
          {error ? <ShieldOff size={15} /> : <Check size={15} />}
          {error || feedback}
        </div>
      )}

      <section className="panel provider-form-panel">
        <header className="panel-header">
          <div><span className="section-kicker">配置入口</span><h3>新增模型资产</h3></div>
          <Plus size={17} />
        </header>
        <div className="asset-form-grid">
          <label className="form-field"><span>名称</span><input value={form.name} onChange={(event) => updateField('name', event.target.value)} /></label>
          <label className="form-field">
            <span>接口类型</span>
            <select
              aria-label="接口类型"
              value={form.providerType}
              onChange={(event) => updateField('providerType', event.target.value as ModelProviderType)}
            >
              <option value="openai-compatible">openai-compatible</option>
              <option value="anthropic-compatible">anthropic-compatible</option>
            </select>
          </label>
          <label className="form-field"><span>Base URL</span><input value={form.baseUrl} onChange={(event) => updateField('baseUrl', event.target.value)} placeholder="https://api.deepseek.com" /></label>
          <label className="form-field"><span>默认模型</span><input value={form.defaultModel} onChange={(event) => updateField('defaultModel', event.target.value)} placeholder="deepseek-v4-pro" /></label>
          <label className="form-field full"><span>Secret Ref（环境变量名）</span><input value={form.secretRef} onChange={(event) => updateField('secretRef', event.target.value)} placeholder="DEEPSEEK_API_KEY" /></label>
        </div>
        <button className="button primary" disabled={isBusy} onClick={() => void createProvider()}>
          <Plus size={15} />创建模型资产
        </button>
      </section>

      <section className="panel provider-list-panel">
        <header className="panel-header">
          <div><span className="section-kicker">资产列表</span><h3>模型资产</h3></div>
          <span className="draft-indicator"><i />{providers.length}</span>
        </header>
        <div className="provider-list">
          {providers.length === 0 && <div className="table-state">暂无模型资产。</div>}
          {providers.map((provider) => {
            const connectivity = connectivityByProviderId[provider.id]
            const impact = impactByProviderId[provider.id]
            const isEditing = editingProviderId === provider.id
            return (
              <article className="provider-card" key={provider.id}>
                {isEditing ? (
                  <div className="provider-edit-form">
                    <label className="form-field"><span>编辑名称</span><input value={editForm.name} onChange={(event) => updateEditField('name', event.target.value)} /></label>
                    <label className="form-field"><span>编辑 Base URL</span><input value={editForm.baseUrl} onChange={(event) => updateEditField('baseUrl', event.target.value)} /></label>
                    <label className="form-field"><span>编辑默认模型</span><input value={editForm.defaultModel} onChange={(event) => updateEditField('defaultModel', event.target.value)} /></label>
                    <label className="form-field"><span>编辑 Secret Ref（环境变量名）</span><input value={editForm.secretRef} onChange={(event) => updateEditField('secretRef', event.target.value)} /></label>
                  </div>
                ) : (
                  <>
                    <div className="provider-card-title">
                      <strong>{provider.name}</strong>
                      <span>{provider.providerType}</span>
                    </div>
                    <dl className="provider-card-config">
                      <div><dt>Base URL</dt><dd>{provider.baseUrl}</dd></div>
                      <div><dt>默认模型</dt><dd>{provider.defaultModel}</dd></div>
                      <div><dt>Secret Ref</dt><dd>{provider.secretRef || '未配置'}</dd></div>
                      <div><dt>状态</dt><dd>{provider.status}</dd></div>
                    </dl>
                    <div className="provider-dependency-summary">
                      {impact ? <>
                        <span>Agent 草稿 {impact.totals.draftAgents}</span>
                        <span>发布版本 {impact.totals.publishedVersions}</span>
                      </> : <span>{impactErrors.includes(provider.id)
                        ? '影响面不可用，不能确认引用数量' : '影响面尚未确认'}</span>}
                    </div>
                  </>
                )}
                {auditByProviderId[provider.id] === null && <p role="status">审计记录不可用或无读取权限</p>}
                {auditByProviderId[provider.id] && <div className="provider-audit">
                  <strong>最近审计</strong>
                  {auditByProviderId[provider.id]?.length === 0 && <p>暂无审计记录</p>}
                  <ul>{auditByProviderId[provider.id]?.map(event => <li key={event.id}>
                    <span>{event.eventType}</span><small>{event.outcome} · {event.reason || '已记录'}</small>
                  </li>)}</ul>
                </div>}
                {connectivity && <p className="provider-connectivity">{connectivity.message}</p>}
                <div className="provider-card-actions">
                  {isEditing ? (
                    <>
                      <button className="button primary compact" disabled={isBusy} onClick={() => void saveProvider(provider)} aria-label={`保存 ${provider.name}`}>
                        <Check size={15} />保存
                      </button>
                      <button className="button secondary compact" disabled={isBusy} onClick={() => setEditingProviderId('')} aria-label={`取消编辑 ${provider.name}`}>
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="button secondary compact" disabled={isBusy} onClick={() => startEditing(provider)} aria-label={`编辑 ${provider.name}`}>
                        编辑
                      </button>
                      <button className="button secondary compact" disabled={isBusy || migrationOnly} onClick={() => void testConnection(provider)} aria-label={`测试连接 ${provider.name}`}>
                        <PlugZap size={15} />测试连接
                      </button>
                      <button className="button danger compact" disabled={isBusy || provider.status === 'disabled'} onClick={() => void deactivateProvider(provider)} aria-label={`停用 ${provider.name}`}>
                        停用
                      </button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
