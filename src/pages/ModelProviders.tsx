import { Check, KeyRound, PlugZap, Plus, ShieldOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  createModelProvider,
  listModelProviders,
  testModelProviderConnection,
  type CreateModelProviderInput,
} from '../api/modelProviders'
import { useWorkspace } from '../auth/workspaceContextState'
import type { ModelProvider, ModelProviderConnectivity, ModelProviderType } from '../types'

const initialForm: CreateModelProviderInput = {
  name: '',
  providerType: 'openai-compatible',
  baseUrl: '',
  defaultModel: '',
  secretRef: '',
}

export function ModelProviders() {
  const { workspace } = useWorkspace()
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [form, setForm] = useState<CreateModelProviderInput>(initialForm)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [connectivityByProviderId, setConnectivityByProviderId] = useState<Record<string, ModelProviderConnectivity>>({})
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    void listModelProviders(workspace.id)
      .then(setProviders)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '模型 Provider 加载失败'))
  }, [workspace.id])

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
            return (
              <article className="provider-card" key={provider.id}>
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
                {connectivity && <p className="provider-connectivity">{connectivity.message}</p>}
                <button className="button secondary compact" disabled={isBusy} onClick={() => void testConnection(provider)} aria-label={`测试连接 ${provider.name}`}>
                  <PlugZap size={15} />测试连接
                </button>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
