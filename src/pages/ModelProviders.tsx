import { Check, KeyRound, PlugZap, Plus, ShieldOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  createModelProvider,
  deactivateModelProvider,
  getModelProviderImpact,
  listModelProviders,
  migrateModelProviderDrafts,
  testModelProviderConnection,
  updateModelProvider,
  type CreateModelProviderInput,
} from '../api/modelProviders'
import { useWorkspace } from '../auth/workspaceContextState'
import type { ModelProvider, ModelProviderConnectivity, ModelProviderImpact, ModelProviderType } from '../types'

const initialForm: CreateModelProviderInput = {
  name: '',
  providerType: 'openai-compatible',
  baseUrl: '',
  defaultModel: '',
  secretRef: '',
}

interface MigrationFormState {
  targetProviderId: string
  reason: string
}

export function ModelProviders() {
  const { workspace } = useWorkspace()
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [form, setForm] = useState<CreateModelProviderInput>(initialForm)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [connectivityByProviderId, setConnectivityByProviderId] = useState<Record<string, ModelProviderConnectivity>>({})
  const [impactByProviderId, setImpactByProviderId] = useState<Record<string, ModelProviderImpact>>({})
  const [editingProviderId, setEditingProviderId] = useState('')
  const [editForm, setEditForm] = useState<CreateModelProviderInput>(initialForm)
  const [migrationForms, setMigrationForms] = useState<Record<string, MigrationFormState>>({})
  const [isBusy, setIsBusy] = useState(false)

  const loadProviderImpacts = useCallback(async (loadedProviders: ModelProvider[]) => {
    const impacts = await Promise.all(loadedProviders.map(async (provider) => {
      try {
        return await getModelProviderImpact(workspace.id, provider.id)
      } catch {
        return undefined
      }
    }))
    setImpactByProviderId(Object.fromEntries(
      impacts
        .filter((impact): impact is ModelProviderImpact => Boolean(impact))
        .map((impact) => [impact.providerId, impact]),
    ))
  }, [workspace.id])

  useEffect(() => {
    void listModelProviders(workspace.id)
      .then((loadedProviders) => {
        setProviders(loadedProviders)
        return loadProviderImpacts(loadedProviders)
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '模型 Provider 加载失败'))
  }, [loadProviderImpacts, workspace.id])

  function updateField<TField extends keyof CreateModelProviderInput>(
    field: TField,
    value: CreateModelProviderInput[TField],
  ) {
    setForm((current) => ({ ...current, [field]: value }))
    setFeedback('')
    setError('')
  }

  async function createProvider() {
    setIsBusy(true)
    setError('')
    try {
      const created = await createModelProvider(workspace.id, {
        ...form,
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        defaultModel: form.defaultModel.trim(),
        secretRef: form.secretRef.trim(),
      })
      setProviders((current) => [created, ...current])
      setForm(initialForm)
      setFeedback('Provider 已创建')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Provider 创建失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function testConnection(provider: ModelProvider) {
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

  function updateMigrationForm(
    providerId: string,
    field: keyof MigrationFormState,
    value: string,
  ) {
    setMigrationForms((current) => ({
      ...current,
      [providerId]: {
        targetProviderId: current[providerId]?.targetProviderId ?? '',
        reason: current[providerId]?.reason ?? '',
        [field]: value,
      },
    }))
    setFeedback('')
    setError('')
  }

  async function saveProvider(provider: ModelProvider) {
    setIsBusy(true)
    setError('')
    try {
      const updated = await updateModelProvider(workspace.id, provider.id, {
        ...editForm,
        name: editForm.name.trim(),
        baseUrl: editForm.baseUrl.trim(),
        defaultModel: editForm.defaultModel.trim(),
        secretRef: editForm.secretRef.trim(),
      })
      setProviders((current) => current.map((item) => item.id === updated.id ? updated : item))
      setEditingProviderId('')
      setFeedback('Provider 已更新')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Provider 更新失败')
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
      setFeedback('Provider 已停用')
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : 'Provider 停用失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function migrateDraftAgents(provider: ModelProvider) {
    const migrationForm = migrationForms[provider.id] ?? { targetProviderId: '', reason: '' }
    const targetProviderId = migrationForm.targetProviderId.trim()
    const reason = migrationForm.reason.trim()
    if (!targetProviderId) {
      setError('请选择迁移目标 Provider')
      return
    }
    if (!reason) {
      setError('请填写迁移原因')
      return
    }

    setIsBusy(true)
    setError('')
    try {
      const result = await migrateModelProviderDrafts(workspace.id, provider.id, { targetProviderId, reason })
      setFeedback(`已迁移 ${result.migratedCount} 个 Agent 草稿`)
      setMigrationForms((current) => ({
        ...current,
        [provider.id]: { targetProviderId, reason: '' },
      }))
      await loadProviderImpacts(providers)
    } catch (migrationError) {
      setError(migrationError instanceof Error ? migrationError.message : 'Agent 草稿迁移失败')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="page-stack model-providers-page">
      <section className="panel model-provider-intro">
        <div>
          <p className="section-kicker">MODEL PROVIDERS</p>
          <h2>模型 Provider</h2>
          <p>统一维护模型 Base URL、默认模型和后端密钥引用。浏览器只保存 Secret Ref，不粘贴密钥。</p>
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
          <div><span className="section-kicker">配置入口</span><h3>新增 Provider</h3></div>
          <Plus size={17} />
        </header>
        <div className="asset-form-grid">
          <label className="form-field"><span>名称</span><input value={form.name} onChange={(event) => updateField('name', event.target.value)} /></label>
          <label className="form-field">
            <span>Provider 类型</span>
            <select
              aria-label="Provider 类型"
              value={form.providerType}
              onChange={(event) => updateField('providerType', event.target.value as ModelProviderType)}
            >
              <option value="openai-compatible">openai-compatible</option>
              <option value="anthropic-compatible">anthropic-compatible</option>
            </select>
          </label>
          <label className="form-field"><span>Base URL</span><input value={form.baseUrl} onChange={(event) => updateField('baseUrl', event.target.value)} placeholder="https://api.deepseek.com" /></label>
          <label className="form-field"><span>默认模型</span><input value={form.defaultModel} onChange={(event) => updateField('defaultModel', event.target.value)} placeholder="deepseek-v4-pro" /></label>
          <label className="form-field full"><span>Secret Ref</span><input value={form.secretRef} onChange={(event) => updateField('secretRef', event.target.value)} placeholder="DEEPSEEK_API_KEY" /></label>
        </div>
        <button className="button primary" disabled={isBusy} onClick={() => void createProvider()}>
          <Plus size={15} />创建 Provider
        </button>
      </section>

      <section className="panel provider-list-panel">
        <header className="panel-header">
          <div><span className="section-kicker">资产列表</span><h3>Provider 资产</h3></div>
          <span className="draft-indicator"><i />{providers.length}</span>
        </header>
        <div className="provider-list">
          {providers.length === 0 && <div className="table-state">暂无模型 Provider。</div>}
          {providers.map((provider) => {
            const connectivity = connectivityByProviderId[provider.id]
            const impact = impactByProviderId[provider.id]
            const isEditing = editingProviderId === provider.id
            const migrationForm = migrationForms[provider.id] ?? { targetProviderId: '', reason: '' }
            const migrationTargets = providers.filter((candidate) => (
              candidate.id !== provider.id && candidate.status !== 'disabled'
            ))
            return (
              <article className="provider-card" key={provider.id}>
                {isEditing ? (
                  <div className="provider-edit-form">
                    <label className="form-field"><span>编辑名称</span><input value={editForm.name} onChange={(event) => updateEditField('name', event.target.value)} /></label>
                    <label className="form-field"><span>编辑 Base URL</span><input value={editForm.baseUrl} onChange={(event) => updateEditField('baseUrl', event.target.value)} /></label>
                    <label className="form-field"><span>编辑默认模型</span><input value={editForm.defaultModel} onChange={(event) => updateEditField('defaultModel', event.target.value)} /></label>
                    <label className="form-field"><span>编辑 Secret Ref</span><input value={editForm.secretRef} onChange={(event) => updateEditField('secretRef', event.target.value)} /></label>
                  </div>
                ) : (
                  <>
                    <div>
                      <strong>{provider.name}</strong>
                      <span>{provider.providerType}</span>
                    </div>
                    <dl>
                      <div><dt>Base URL</dt><dd>{provider.baseUrl}</dd></div>
                      <div><dt>默认模型</dt><dd>{provider.defaultModel}</dd></div>
                      <div><dt>Secret Ref</dt><dd>{provider.secretRef}</dd></div>
                      <div><dt>状态</dt><dd>{provider.status}</dd></div>
                    </dl>
                  </>
                )}
                {connectivity && <p className="provider-connectivity">{connectivity.message}</p>}
                {impact && (
                  <div className="provider-impact">
                    <div className="provider-impact-metrics">
                      <span>草稿 Agent {impact.totals.draftAgents}</span>
                      <span>已发布版本 {impact.totals.publishedVersions}</span>
                    </div>
                    {(impact.draftAgents.length > 0 || impact.publishedVersions.length > 0) ? (
                      <ul>
                        {impact.draftAgents.slice(0, 3).map((agent) => (
                          <li key={`draft-${agent.agentId}`}>{agent.agentName}</li>
                        ))}
                        {impact.publishedVersions.slice(0, 3).map((version) => (
                          <li key={`version-${version.versionId}`}>{version.agentName} {version.version}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>暂无 Agent 依赖</p>
                    )}
                  </div>
                )}
                {migrationTargets.length > 0 && (
                  <div className="provider-migration-form">
                    <div>
                      <strong>草稿迁移</strong>
                      <span>只迁移当前 Agent 草稿，已发布版本快照保持不变。</span>
                    </div>
                    <label className="form-field">
                      <span>迁移目标</span>
                      <select
                        aria-label={`迁移目标 ${provider.name}`}
                        value={migrationForm.targetProviderId}
                        onChange={(event) => updateMigrationForm(provider.id, 'targetProviderId', event.target.value)}
                      >
                        <option value="">选择目标 Provider</option>
                        {migrationTargets.map((target) => (
                          <option key={target.id} value={target.id}>{target.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field migration-reason-field">
                      <span>迁移原因</span>
                      <textarea
                        aria-label={`迁移原因 ${provider.name}`}
                        value={migrationForm.reason}
                        onChange={(event) => updateMigrationForm(provider.id, 'reason', event.target.value)}
                        placeholder="例如：切换到生产 Provider"
                        rows={2}
                      />
                    </label>
                    <button
                      className="button secondary compact"
                      disabled={isBusy}
                      onClick={() => void migrateDraftAgents(provider)}
                      aria-label={`迁移草稿 ${provider.name}`}
                    >
                      迁移草稿
                    </button>
                  </div>
                )}
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
                      <button className="button secondary compact" disabled={isBusy} onClick={() => void testConnection(provider)} aria-label={`测试连接 ${provider.name}`}>
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
