import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, History, PencilLine, Plus, RefreshCw, Save, Send, ShieldOff, X } from 'lucide-react'
import {
  createRubric,
  deactivateRubric,
  getRubrics,
  listRubricVersions,
  publishRubric,
  updateRubric,
  type RubricInput,
} from '../api/evaluations'
import { listModelProviders } from '../api/modelProviders'
import { useNavigate, useParams } from 'react-router-dom'
import { useWorkspace } from '../auth/workspaceContextState'
import type { ModelProvider, Rubric, RubricVersion } from '../types'

let dimensionSequence = 0

function createDimensionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  dimensionSequence += 1
  return `dimension-${dimensionSequence}`
}

function emptyForm(): RubricInput {
  return {
    name: '',
    artifact: '',
    dimensions: [{ id: createDimensionId(), name: '', weight: 100, criteria: '' }],
    gate: '',
    passScore: 85,
    judgeType: 'deterministic',
    judgeModel: '',
    modelProviderId: null,
  }
}

function formFromRubric(rubric: Rubric): RubricInput {
  return {
    name: rubric.name,
    artifact: rubric.artifact,
    dimensions: rubric.dimensions.map((dimension) => ({
      id: dimension.id?.trim() || createDimensionId(),
      name: dimension.name,
      weight: dimension.weight,
      criteria: dimension.criteria ?? '',
    })),
    gate: rubric.gate,
    passScore: rubric.passScore,
    judgeType: rubric.judgeType,
    judgeModel: rubric.judgeModel,
    modelProviderId: rubric.modelProviderId ?? null,
  }
}

function usableProvider(provider: ModelProvider) {
  return provider.status !== 'disabled'
    && Boolean(provider.id.trim())
    && Boolean(provider.name.trim())
    && Boolean(provider.baseUrl.trim())
    && Boolean(provider.defaultModel.trim())
    && Boolean(provider.secretRef.trim())
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase('zh-CN')
}

function validate(input: RubricInput, providers: ModelProvider[]) {
  if (!input.name.trim()) return '模板名称不能为空'
  if (!input.artifact.trim()) return '适用产出物不能为空'
  if (!input.gate.trim()) return '硬性门禁不能为空'
  if (input.passScore < 0 || input.passScore > 100) return '通过分数必须在 0 到 100 之间'
  if (input.dimensions.length === 0) return '至少需要 1 个评分维度'
  if (input.dimensions.some((dimension) => !dimension.id.trim())) return '维度 ID 不能为空'
  if (input.dimensions.some((dimension) => !dimension.name.trim())) return '维度名称不能为空'
  if (input.dimensions.some((dimension) => !dimension.criteria.trim())) return '维度评分标准不能为空'
  const ids = input.dimensions.map((dimension) => normalized(dimension.id))
  const names = input.dimensions.map((dimension) => normalized(dimension.name))
  if (new Set(ids).size !== ids.length) return '维度 ID 不能重复'
  if (new Set(names).size !== names.length) return '维度名称不能重复'
  if (input.dimensions.some((dimension) => !Number.isInteger(dimension.weight) || dimension.weight < 1 || dimension.weight > 100)) {
    return '维度权重必须在 1 到 100 之间'
  }
  if (input.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0) !== 100) {
    return '维度权重合计必须等于 100'
  }
  if (input.judgeType === 'llm') {
    if (!input.modelProviderId || !providers.some((provider) => provider.id === input.modelProviderId)) {
      return '请选择可用的 Model Provider'
    }
    if (!input.judgeModel?.trim()) return 'Judge 模型不能为空'
  }
  return ''
}

function statusLabel(status?: string) {
  if (status === 'active') return '已发布'
  if (status === 'disabled') return '已停用'
  return '草稿'
}

export function Evaluations() {
  const { workspace, workspacePath } = useWorkspace()
  const navigate = useNavigate()
  const { rubricId: routeRubricId } = useParams()
  const isEditorRoute = Boolean(routeRubricId)
  const [rubrics, setRubrics] = useState<Rubric[]>([])
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editingRubric, setEditingRubric] = useState<Rubric | null>(null)
  const [versions, setVersions] = useState<RubricVersion[]>([])
  const [activeEditorId, setActiveEditorId] = useState<string | null>(null)
  const [versionDialogRubric, setVersionDialogRubric] = useState<Rubric | null>(null)
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [versionLoadError, setVersionLoadError] = useState('')
  const [form, setForm] = useState<RubricInput>(() => emptyForm())
  const [isBusy, setIsBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [feedback, setFeedback] = useState('')

  const availableProviders = useMemo(() => providers.filter(usableProvider), [providers])
  const totalWeight = form.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0)
  const disabled = editingRubric?.status === 'disabled'

  const loadAssets = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      const [nextRubrics, nextProviders] = await Promise.all([
        getRubrics(workspace.id),
        listModelProviders(workspace.id),
      ])
      setRubrics(nextRubrics)
      setProviders(nextProviders)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '评估模板加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [workspace.id])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  useEffect(() => {
    if (!routeRubricId || isLoading || activeEditorId === routeRubricId) return
    setVersions([])
    setFormError('')
    setFeedback('')
    setActiveEditorId(routeRubricId)
    if (routeRubricId === 'new') {
      setEditingRubric(null)
      setForm(emptyForm())
      return
    }
    const rubric = rubrics.find((item) => item.id === routeRubricId)
    if (!rubric) {
      setEditingRubric(null)
      setForm(emptyForm())
      setFormError('评估模板不存在或已被移除')
      return
    }
    setEditingRubric(rubric)
    setForm(formFromRubric(rubric))
    void listRubricVersions(workspace.id, rubric.id)
      .then(setVersions)
      .catch((error) => setFormError(error instanceof Error ? error.message : '模板版本加载失败'))
  }, [activeEditorId, isLoading, routeRubricId, rubrics, workspace.id])

  function openEditor(rubricId: string) {
    setActiveEditorId(null)
    navigate(workspacePath(`evaluations/${rubricId}`))
  }

  function returnToList() {
    setActiveEditorId(null)
    setEditingRubric(null)
    setVersions([])
    setForm(emptyForm())
    setFormError('')
    setFeedback('')
    navigate(workspacePath('evaluations'))
  }

  async function openVersionDialog(rubric: Rubric) {
    setVersionDialogRubric(rubric)
    setVersions([])
    setVersionLoadError('')
    setIsLoadingVersions(true)
    try {
      setVersions(await listRubricVersions(workspace.id, rubric.id))
    } catch (error) {
      setVersionLoadError(error instanceof Error ? error.message : '模板版本加载失败')
    } finally {
      setIsLoadingVersions(false)
    }
  }

  function closeVersionDialog() {
    setVersionDialogRubric(null)
    setVersions([])
    setVersionLoadError('')
  }

  function updateDimension(index: number, patch: Partial<RubricInput['dimensions'][number]>) {
    setForm((current) => ({
      ...current,
      dimensions: current.dimensions.map((dimension, dimensionIndex) => (
        dimensionIndex === index ? { ...dimension, ...patch } : dimension
      )),
    }))
  }

  async function saveTemplate() {
    const validationError = validate(form, availableProviders)
    if (validationError) {
      setFormError(validationError)
      setFeedback('')
      return
    }
    setIsBusy(true)
    setFormError('')
    setFeedback('')
    const input: RubricInput = {
      ...form,
      name: form.name.trim(),
      artifact: form.artifact.trim(),
      gate: form.gate.trim(),
      judgeModel: form.judgeType === 'llm' ? form.judgeModel?.trim() ?? '' : '',
      modelProviderId: form.judgeType === 'llm' ? form.modelProviderId : null,
      dimensions: form.dimensions.map((dimension) => ({
        id: dimension.id.trim(),
        name: dimension.name.trim(),
        weight: dimension.weight,
        criteria: dimension.criteria.trim(),
      })),
    }
    try {
      const saved = editingRubric
        ? await updateRubric(workspace.id, editingRubric.id, input)
        : await createRubric(workspace.id, input)
      setRubrics((current) => editingRubric
        ? current.map((rubric) => rubric.id === saved.id ? saved : rubric)
        : [...current, saved])
      setEditingRubric(saved)
      setForm(formFromRubric(saved))
      setFeedback(editingRubric ? '评估模板已保存' : '评估模板已创建')
      if (!editingRubric) {
        setActiveEditorId(saved.id)
        navigate(workspacePath(`evaluations/${saved.id}`))
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '评估模板保存失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function publishCurrent() {
    if (!editingRubric) return
    setIsBusy(true)
    setFormError('')
    setFeedback('')
    try {
      const published = await publishRubric(workspace.id, editingRubric.id)
      const updated = { ...editingRubric, version: published.version, status: 'active' }
      setEditingRubric(updated)
      setRubrics((current) => current.map((rubric) => rubric.id === updated.id ? updated : rubric))
      setVersions(await listRubricVersions(workspace.id, editingRubric.id))
      setFeedback(`已发布不可变版本 ${published.version}`)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '评估模板发布失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function deactivateCurrent() {
    if (!editingRubric) return
    setIsBusy(true)
    setFormError('')
    setFeedback('')
    try {
      const updated = await deactivateRubric(workspace.id, editingRubric.id)
      setEditingRubric(updated)
      setRubrics((current) => current.map((rubric) => rubric.id === updated.id ? updated : rubric))
      setFeedback('评估模板已停用')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '评估模板停用失败')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="page-stack">
      {!isEditorRoute && (
        <>
          <section className="page-toolbar">
            <div>
              <p className="eyebrow">EVALUATION TEMPLATES</p>
              <h2>评估模板</h2>
              <p>管理可被工作流评估节点复用的评分标准、模型绑定和发布版本。</p>
            </div>
            <div className="toolbar-actions">
              <button className="button secondary" type="button" onClick={() => void loadAssets()} disabled={isLoading}>
                <RefreshCw size={16} />刷新
              </button>
              <button className="button primary" type="button" onClick={() => openEditor('new')}>
                <Plus size={16} />新建评估模板
              </button>
            </div>
          </section>

          {isLoading && <section className="panel table-state">正在加载评估模板…</section>}
          {loadError && <section className="panel inline-feedback error" role="alert">{loadError}</section>}
          {!isLoading && !loadError && rubrics.length === 0 && (
            <section className="panel table-state">
              <h3>还没有评估模板</h3>
              <p>创建第一个模板，发布后即可在工作流评估节点中选择。</p>
              <button className="button primary" type="button" onClick={() => openEditor('new')}>创建第一个模板</button>
            </section>
          )}
          {!isLoading && !loadError && rubrics.length > 0 && (
            <section className="evaluation-directory-panel" aria-label="评估模板列表">
              <div className="evaluation-directory-list">
                {rubrics.map((rubric) => {
                  const provider = providers.find((item) => item.id === rubric.modelProviderId)
                  const model = rubric.judgeType === 'llm'
                    ? `${provider?.name ?? '未绑定 Provider'} / ${rubric.judgeModel || '未配置模型'}`
                    : '确定性评分'
                  return (
                    <article className="evaluation-directory-row" aria-label={rubric.name} key={rubric.id}>
                      <div className="evaluation-directory-main">
                        <button type="button" onClick={() => openEditor(rubric.id)}>{rubric.name}</button>
                      </div>
                      <div className="evaluation-directory-meta" aria-label={`${rubric.name} 元信息`}>
                        <span className="model"><small>使用模型</small><strong>{model}</strong></span>
                        <span><small>版本</small><strong>{rubric.version}</strong></span>
                        <span><small>状态</small><strong>{statusLabel(rubric.status)}</strong></span>
                        <span><small>通过分</small><strong>{rubric.passScore}</strong></span>
                        <span><small>维度</small><strong>{rubric.dimensions.length} 个维度</strong></span>
                      </div>
                      <div className="evaluation-directory-actions">
                        <button
                          aria-label={`查看版本记录 ${rubric.name}`}
                          className="button ghost compact"
                          type="button"
                          onClick={() => void openVersionDialog(rubric)}
                        >
                          <History size={14} />版本记录
                        </button>
                        <button
                          aria-label={`编辑 ${rubric.name}`}
                          className="button primary compact"
                          type="button"
                          onClick={() => openEditor(rubric.id)}
                        >
                          <PencilLine size={14} />编辑
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      {isEditorRoute && isLoading && <section className="panel table-state">正在加载评估模板…</section>}
      {isEditorRoute && !isLoading && (
        <>
          <div className="rubric-editor-return">
            <button className="button ghost" type="button" onClick={returnToList}>
              <ArrowLeft size={15} />返回评估模板列表
            </button>
          </div>
          <section className="panel rubric-editor-page" aria-labelledby="template-editor-title">
            <header>
              <div>
                <p className="eyebrow">{editingRubric ? 'MANAGE TEMPLATE' : 'CREATE TEMPLATE'}</p>
                <h2 id="template-editor-title">{editingRubric ? '管理评估模板' : '新建评估模板'}</h2>
              </div>
            </header>
            <form onSubmit={(event) => { event.preventDefault(); void saveTemplate() }}>
              <label className="dialog-field">模板名称
                <input aria-label="模板名称" value={form.name} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label className="dialog-field">适用产出物
                <input aria-label="适用产出物" value={form.artifact} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, artifact: event.target.value }))} />
              </label>
              <label className="dialog-field">硬性门禁
                <textarea aria-label="硬性门禁" rows={3} value={form.gate} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, gate: event.target.value }))} />
              </label>
              <label className="dialog-field">通过分数
                <input aria-label="通过分数" type="number" min={0} max={100} value={form.passScore} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, passScore: Number(event.target.value) }))} />
              </label>
              <label className="dialog-field">评分器类型
                <select aria-label="评分器类型" value={form.judgeType} disabled={disabled} onChange={(event) => setForm((current) => ({
                  ...current,
                  judgeType: event.target.value as RubricInput['judgeType'],
                  judgeModel: event.target.value === 'llm' ? current.judgeModel : '',
                  modelProviderId: event.target.value === 'llm' ? current.modelProviderId : null,
                }))}>
                  <option value="deterministic">确定性评分</option>
                  <option value="llm">LLM Judge</option>
                </select>
              </label>
              {form.judgeType === 'llm' && (
                <>
                  <label className="dialog-field">Model Provider
                    <select aria-label="Model Provider" value={form.modelProviderId ?? ''} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, modelProviderId: event.target.value || null }))}>
                      <option value="">请选择 Model Provider</option>
                      {availableProviders.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                    </select>
                    {availableProviders.length === 0 && <small>暂无配置完整且未停用的 Model Provider</small>}
                  </label>
                  <label className="dialog-field">Judge 模型
                    <input aria-label="Judge 模型" value={form.judgeModel ?? ''} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, judgeModel: event.target.value }))} />
                  </label>
                </>
              )}

              <div className="rubric-dimension-editor">
                <div className="rubric-dimension-header">
                  <span>评分维度</span>
                  <strong className={totalWeight === 100 ? 'success-text' : 'danger-text'}>合计 {totalWeight}%</strong>
                </div>
                {form.dimensions.map((dimension, index) => (
                  <div className="rubric-dimension-row" key={`${dimension.id}-${index}`}>
                    <label className="dialog-field rubric-dimension-name">维度 {index + 1} 名称
                      <input aria-label={`维度 ${index + 1} 名称`} value={dimension.name} disabled={disabled} onChange={(event) => updateDimension(index, { name: event.target.value })} />
                    </label>
                    <label className="dialog-field rubric-dimension-criteria">维度 {index + 1} 评分标准
                      <textarea aria-label={`维度 ${index + 1} 评分标准`} rows={2} value={dimension.criteria} disabled={disabled} onChange={(event) => updateDimension(index, { criteria: event.target.value })} />
                    </label>
                    <label className="dialog-field rubric-dimension-weight">维度 {index + 1} 权重
                      <input aria-label={`维度 ${index + 1} 权重`} type="number" min={1} max={100} value={dimension.weight} disabled={disabled} onChange={(event) => updateDimension(index, { weight: Number(event.target.value) })} />
                    </label>
                    {form.dimensions.length > 1 && <button className="button secondary" type="button" disabled={disabled} onClick={() => setForm((current) => ({ ...current, dimensions: current.dimensions.filter((_, itemIndex) => itemIndex !== index) }))}>删除维度</button>}
                  </div>
                ))}
                <button className="button secondary" type="button" disabled={disabled} onClick={() => setForm((current) => ({ ...current, dimensions: [...current.dimensions, { id: createDimensionId(), name: '', weight: 1, criteria: '' }] }))}>
                  <Plus size={14} />增加维度
                </button>
              </div>

              {formError && <p className="dialog-error" role="alert">{formError}</p>}
              {feedback && !formError && <p className="inline-feedback" role="status">{feedback}</p>}
              <footer>
                <button className="button secondary" type="button" onClick={returnToList}>返回列表</button>
                {editingRubric && (
                  <>
                    <button className="button secondary" type="button" disabled={isBusy || disabled} onClick={() => void publishCurrent()}><Send size={15} />发布版本</button>
                    <button className="button secondary danger-button" type="button" aria-label="停用模板" disabled={isBusy || disabled} onClick={() => void deactivateCurrent()}><ShieldOff size={15} />停用模板</button>
                  </>
                )}
                <button className="button primary" type="submit" disabled={isBusy || disabled}><Save size={15} />保存模板</button>
              </footer>
            </form>
            {editingRubric && (
              <div className="rubric-version-list">
                <h3>版本记录</h3>
                {versions.length === 0 && <p>暂无已发布版本</p>}
                {versions.map((version) => <p key={version.id}><strong>版本 {version.version}</strong> · {new Date(version.createdAt).toLocaleString('zh-CN')}</p>)}
              </div>
            )}
          </section>
        </>
      )}

      {versionDialogRubric && (
        <div className="dialog-backdrop">
          <section className="agent-dialog rubric-version-dialog" role="dialog" aria-modal="true" aria-labelledby="rubric-version-title">
            <header>
              <div>
                <p className="eyebrow">IMMUTABLE SNAPSHOTS</p>
                <h2 id="rubric-version-title">评估模板版本记录</h2>
                <span className="dialog-subtitle">{versionDialogRubric.name}</span>
              </div>
              <button className="icon-button quiet" type="button" title="关闭" onClick={closeVersionDialog}><X size={18} /></button>
            </header>
            <div className="rubric-version-list standalone">
              {isLoadingVersions && <p>正在加载版本记录</p>}
              {!isLoadingVersions && versionLoadError && <p className="dialog-error" role="alert">{versionLoadError}</p>}
              {!isLoadingVersions && !versionLoadError && versions.length === 0 && <p>暂无已发布版本</p>}
              {versions.map((version) => <p key={version.id}><strong>版本 {version.version}</strong> · {new Date(version.createdAt).toLocaleString('zh-CN')}</p>)}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
