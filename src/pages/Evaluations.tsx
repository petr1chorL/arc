import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Beaker,
  CheckCircle2,
  FlaskConical,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import {
  createRubric,
  deactivateRubric,
  evaluateRubric,
  getEvaluationOverview,
  getRubrics,
  listEvaluationRecords,
  listRubricVersions,
  publishRubric,
  updateRubric,
  type RubricInput,
} from '../api/evaluations'
import { useWorkspace } from '../auth/workspaceContextState'
import type { EvaluationRecord, EvaluationOverview, Rubric, RubricVersion } from '../types'

const emptyOverview: EvaluationOverview = {
  totals: {
    feedbackCandidates: 0,
    pendingCandidates: 0,
    confirmedCandidates: 0,
    goldenSamples: 0,
    coveredWorkflows: 0,
    coveredAgents: 0,
  },
  recentCandidates: [],
}

const emptyForm: RubricInput = {
  name: '',
  artifact: '',
  dimensions: [{ name: '', weight: 100 }],
  gate: '',
  passScore: 85,
}

function toRubricInput(rubric: Rubric): RubricInput {
  return {
    name: rubric.name,
    artifact: rubric.artifact,
    dimensions: rubric.dimensions.map((dimension) => ({ ...dimension })),
    gate: rubric.gate,
    passScore: rubric.passScore,
  }
}

function validateRubric(input: RubricInput): string {
  if (!input.name.trim()) return '名称不能为空'
  if (!input.artifact.trim()) return '适用产出物不能为空'
  if (!input.gate.trim()) return '硬性门禁不能为空'
  if (input.passScore < 0 || input.passScore > 100) return '通过分数必须在 0 到 100 之间'
  if (input.dimensions.length === 0) return '至少需要 1 个评分维度'
  if (input.dimensions.some((dimension) => !dimension.name.trim())) return '维度名称不能为空'
  if (input.dimensions.some((dimension) => dimension.weight <= 0 || dimension.weight > 100)) {
    return '维度权重必须在 1 到 100 之间'
  }
  const totalWeight = input.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0)
  if (totalWeight !== 100) return '维度权重合计必须等于 100'
  return ''
}

export function Evaluations() {
  const { workspace } = useWorkspace()
  const [overview, setOverview] = useState<EvaluationOverview>(emptyOverview)
  const [rubrics, setRubrics] = useState<Rubric[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isRubricDialogOpen, setIsRubricDialogOpen] = useState(false)
  const [editingRubric, setEditingRubric] = useState<Rubric | null>(null)
  const [form, setForm] = useState<RubricInput>(emptyForm)
  const [versions, setVersions] = useState<RubricVersion[]>([])
  const [formError, setFormError] = useState('')
  const [formFeedback, setFormFeedback] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [evaluationText, setEvaluationText] = useState('')
  const [evaluationResult, setEvaluationResult] = useState<EvaluationRecord | null>(null)
  const [evaluationError, setEvaluationError] = useState('')
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [evaluationRecords, setEvaluationRecords] = useState<EvaluationRecord[]>([])
  const [recordStatusFilter, setRecordStatusFilter] = useState('all')
  const [recordRubricFilter, setRecordRubricFilter] = useState('all')

  const loadAssets = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const [nextOverview, nextRubrics, nextRecords] = await Promise.all([
        getEvaluationOverview(workspace.id),
        getRubrics(workspace.id),
        listEvaluationRecords(workspace.id),
      ])
      setOverview(nextOverview)
      setRubrics(nextRubrics)
      setEvaluationRecords(nextRecords)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '评估资产加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [workspace.id])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  const totalWeight = useMemo(
    () => form.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0),
    [form.dimensions],
  )

  const filteredEvaluationRecords = useMemo(() => evaluationRecords.filter((record) => (
    (recordStatusFilter === 'all' || record.status === recordStatusFilter)
    && (recordRubricFilter === 'all' || record.rubricId === recordRubricFilter)
  )), [evaluationRecords, recordRubricFilter, recordStatusFilter])

  const recordRubricOptions = useMemo(() => {
    const knownRubricIds = new Set(rubrics.map((rubric) => rubric.id))
    const unknownRecordRubrics = new Map<string, string>()
    for (const record of evaluationRecords) {
      if (!knownRubricIds.has(record.rubricId)) {
        unknownRecordRubrics.set(record.rubricId, record.rubricSnapshot.name)
      }
    }
    return Array.from(unknownRecordRubrics, ([id, name]) => ({ id, name }))
  }, [evaluationRecords, rubrics])

  function openCreateDialog() {
    setIsRubricDialogOpen(true)
    setEditingRubric(null)
    setForm({ ...emptyForm, dimensions: emptyForm.dimensions.map((dimension) => ({ ...dimension })) })
    setVersions([])
    setFormError('')
    setFormFeedback('')
    setEvaluationText('')
    setEvaluationResult(null)
    setEvaluationError('')
  }

  async function openEditDialog(rubric: Rubric) {
    setIsRubricDialogOpen(true)
    setEditingRubric(rubric)
    setForm(toRubricInput(rubric))
    setFormError('')
    setFormFeedback('')
    setEvaluationText('')
    setEvaluationResult(null)
    setEvaluationError('')
    try {
      setVersions(await listRubricVersions(workspace.id, rubric.id))
    } catch {
      setVersions([])
    }
  }

  function closeDialog() {
    setIsRubricDialogOpen(false)
    setEditingRubric(null)
    setForm({ ...emptyForm, dimensions: emptyForm.dimensions.map((dimension) => ({ ...dimension })) })
    setVersions([])
    setFormError('')
    setFormFeedback('')
    setEvaluationText('')
    setEvaluationResult(null)
    setEvaluationError('')
  }

  function updateDimension(index: number, patch: Partial<RubricInput['dimensions'][number]>) {
    setForm((current) => ({
      ...current,
      dimensions: current.dimensions.map((dimension, dimensionIndex) => (
        dimensionIndex === index ? { ...dimension, ...patch } : dimension
      )),
    }))
  }

  async function saveRubric() {
    const validationError = validateRubric(form)
    if (validationError) {
      setFormError(validationError)
      setFormFeedback('')
      return
    }
    setIsBusy(true)
    setFormError('')
    try {
      const input = {
        ...form,
        name: form.name.trim(),
        artifact: form.artifact.trim(),
        gate: form.gate.trim(),
        dimensions: form.dimensions.map((dimension) => ({
          name: dimension.name.trim(),
          weight: dimension.weight,
        })),
      }
      const saved = editingRubric
        ? await updateRubric(workspace.id, editingRubric.id, input)
        : await createRubric(workspace.id, input)
      setRubrics((current) => {
        const exists = current.some((rubric) => rubric.id === saved.id)
        return exists
          ? current.map((rubric) => (rubric.id === saved.id ? saved : rubric))
          : [...current, saved]
      })
      setEditingRubric(saved)
      setForm(toRubricInput(saved))
      setFormFeedback(editingRubric ? '评分量规已保存' : '评分量规已创建')
      setVersions(await listRubricVersions(workspace.id, saved.id))
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : '评分量规保存失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function publishCurrentRubric() {
    if (!editingRubric) return
    setIsBusy(true)
    setFormError('')
    try {
      const published = await publishRubric(workspace.id, editingRubric.id)
      const nextRubric = { ...editingRubric, version: published.version, status: 'active' }
      setEditingRubric(nextRubric)
      setRubrics((current) => current.map((rubric) => (
        rubric.id === nextRubric.id ? nextRubric : rubric
      )))
      setVersions(await listRubricVersions(workspace.id, editingRubric.id))
      setFormFeedback(`已发布不可变版本 ${published.version}`)
    } catch (publishError) {
      setFormError(publishError instanceof Error ? publishError.message : '评分量规发布失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function deactivateCurrentRubric() {
    if (!editingRubric) return
    setIsBusy(true)
    setFormError('')
    try {
      const disabled = await deactivateRubric(workspace.id, editingRubric.id)
      setEditingRubric(disabled)
      setRubrics((current) => current.map((rubric) => (
        rubric.id === disabled.id ? disabled : rubric
      )))
      setFormFeedback('评分量规已停用')
    } catch (deactivateError) {
      setFormError(deactivateError instanceof Error ? deactivateError.message : '评分量规停用失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function runEvaluation() {
    if (!editingRubric) return
    if (!evaluationText.trim()) {
      setEvaluationError('待评估产出物不能为空')
      return
    }
    setIsEvaluating(true)
    setEvaluationError('')
    try {
      const result = await evaluateRubric(workspace.id, editingRubric.id, {
        artifactText: evaluationText.trim(),
        subjectType: 'manual_artifact',
        subjectId: null,
      })
      setEvaluationResult(result)
      setEvaluationRecords((current) => [
        result,
        ...current.filter((record) => record.id !== result.id),
      ])
    } catch (runError) {
      setEvaluationError(runError instanceof Error ? runError.message : '运行评估失败')
    } finally {
      setIsEvaluating(false)
    }
  }

  const disabled = editingRubric?.status === 'disabled'

  return (
    <div className="page-stack">
      <section className="page-toolbar">
        <div><p>把质量标准变成可执行的门禁、评分量规和回归测试。</p></div>
        <div className="toolbar-actions">
          <button className="button secondary" type="button" onClick={() => void loadAssets()} disabled={isLoading}>
            <RefreshCw size={16} />刷新资产
          </button>
          <button className="button primary" type="button" onClick={openCreateDialog}>
            <Plus size={16} />新建评分量规
          </button>
        </div>
      </section>

      <section className="evaluation-overview">
        <div className="evaluation-stat"><ShieldCheck size={20} /><span>反馈候选<strong>{overview.totals.feedbackCandidates}</strong></span><small>人工修改沉淀来源</small></div>
        <div className="evaluation-stat"><FlaskConical size={20} /><span>Golden Sample<strong>{overview.totals.goldenSamples}</strong></span><small>{overview.totals.confirmedCandidates} 条已确认</small></div>
        <div className="evaluation-stat"><CheckCircle2 size={20} /><span>覆盖工作流<strong>{overview.totals.coveredWorkflows}</strong></span><small>来自真实 Human Task</small></div>
        <div className="evaluation-stat"><Beaker size={20} /><span>待确认候选<strong>{overview.totals.pendingCandidates}</strong></span><small>{overview.totals.coveredAgents} 个 Agent 涉及</small></div>
      </section>

      <section className="panel evaluation-assets">
        <header>
          <div>
            <span className="eyebrow">EVALUATION ASSETS</span>
            <h2>评估资产概览</h2>
          </div>
          {isLoading && <span className="status-pill">同步中</span>}
          {error && <span className="status-pill danger">加载失败</span>}
        </header>
        {error && <div className="inline-feedback error" role="alert">{error}</div>}
        {!isLoading && !error && overview.recentCandidates.length === 0 && (
          <div className="table-state">暂无反馈候选。完成一次“修改后通过”，并由专家确认后，会在这里形成 Golden Sample。</div>
        )}
        {overview.recentCandidates.length > 0 && (
          <div className="evaluation-candidate-list">
            {overview.recentCandidates.map((candidate) => (
              <article key={candidate.id} className="evaluation-candidate">
                <div>
                  <span className="mono">{candidate.id}</span>
                  <h3>{candidate.reason}</h3>
                  <p>{candidate.workflowId ?? '未绑定工作流'} / {candidate.agentId ?? '未绑定 Agent'} / {candidate.sourceNodeId}</p>
                </div>
                <div className="candidate-tags">
                  <span className={`status-pill ${candidate.status === '已确认' ? 'success' : ''}`}>{candidate.status}</span>
                  {candidate.tags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel evaluation-records">
        <header>
          <div>
            <span className="eyebrow">EVALUATION HISTORY</span>
            <h2>评估记录</h2>
          </div>
          <div className="evaluation-record-filters">
            <label>
              状态筛选
              <select
                aria-label="状态筛选"
                value={recordStatusFilter}
                onChange={(event) => setRecordStatusFilter(event.target.value)}
              >
                <option value="all">全部状态</option>
                <option value="passed">passed</option>
                <option value="failed">failed</option>
              </select>
            </label>
            <label>
              Rubric 筛选
              <select
                aria-label="Rubric 筛选"
                value={recordRubricFilter}
                onChange={(event) => setRecordRubricFilter(event.target.value)}
              >
                <option value="all">全部 Rubric</option>
                {rubrics.map((rubric) => (
                  <option key={rubric.id} value={rubric.id}>{rubric.name}</option>
                ))}
                {recordRubricOptions.map((rubric) => (
                  <option key={rubric.id} value={rubric.id}>{rubric.name}</option>
                ))}
              </select>
            </label>
          </div>
        </header>
        {evaluationRecords.length === 0 && (
          <div className="table-state">暂无评估记录。打开任意 Rubric 配置弹窗运行一次评估后，会在这里沉淀历史。</div>
        )}
        {evaluationRecords.length > 0 && filteredEvaluationRecords.length === 0 && (
          <div className="table-state">当前筛选条件下暂无评估记录。</div>
        )}
        {filteredEvaluationRecords.length > 0 && (
          <div className="evaluation-record-list">
            {filteredEvaluationRecords.map((record) => (
              <article className="evaluation-record-card" key={record.id}>
                <div>
                  <span className="mono">{record.id}</span>
                  <h3>{record.rubricSnapshot.name}</h3>
                  <p>{record.subjectType}{record.subjectId ? ` / ${record.subjectId}` : ''} / {record.rubricVersion}</p>
                </div>
                <div className="evaluation-record-score">
                  <strong>{record.score}</strong>
                  <span className={`status-pill ${record.status === 'passed' ? 'success' : 'danger'}`}>{record.status}</span>
                </div>
                <div className="evaluation-record-dimensions">
                  {record.dimensionScores.map((dimension) => (
                    <span key={`${record.id}-${dimension.name}`}>{dimension.name} {dimension.score}</span>
                  ))}
                </div>
                <p>{record.rationale}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <header>
          <div>
            <span className="eyebrow">RUBRIC LIBRARY</span>
            <h2>评分量规</h2>
          </div>
          {isLoading && <span className="status-pill">同步中</span>}
          {!isLoading && !error && <span className="status-pill success">{rubrics.length} 个可用</span>}
        </header>
        {!isLoading && !error && rubrics.length === 0 && (
          <div className="table-state">暂无评分量规。</div>
        )}
        {rubrics.length > 0 && (
          <div className="rubric-grid">
            {rubrics.map((rubric) => (
              <article className="rubric-card" key={rubric.id}>
                <header>
                  <div>
                    <span className="mono">{rubric.id} / {rubric.version}</span>
                    <h3>{rubric.name}</h3>
                    <p>适用产出物：{rubric.artifact}</p>
                  </div>
                  <button
                    className="icon-button quiet"
                    title="配置量规"
                    type="button"
                    onClick={() => void openEditDialog(rubric)}
                  >
                    <SlidersHorizontal size={17} />
                  </button>
                </header>
                <div className="gate-rule"><ShieldCheck size={16} /><span><b>硬性门禁</b>{rubric.gate}</span></div>
                <div className="dimension-list">
                  {rubric.dimensions.map((dimension) => (
                    <div key={dimension.name}>
                      <span>{dimension.name}</span>
                      <div className="weight-track"><i style={{ width: `${dimension.weight}%` }} /></div>
                      <strong>{dimension.weight}%</strong>
                    </div>
                  ))}
                </div>
                <footer>
                  <span>自动流转阈值 <strong>≥ {rubric.passScore}</strong></span>
                  <button type="button" onClick={() => void openEditDialog(rubric)}>
                    查看版本 <ArrowRight size={14} />
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      {isRubricDialogOpen && (
        <div className="dialog-backdrop">
          <section className="agent-dialog rubric-dialog" role="dialog" aria-modal="true" aria-labelledby="rubric-dialog-title">
            <header>
              <div>
                <p className="eyebrow">{editingRubric ? 'EDIT RUBRIC' : 'CREATE RUBRIC'}</p>
                <h2 id="rubric-dialog-title">{editingRubric ? '配置评分量规' : '新建评分量规'}</h2>
              </div>
              <button className="icon-button quiet" type="button" title="关闭" onClick={closeDialog}>
                <X size={18} />
              </button>
            </header>

            <form onSubmit={(event) => {
              event.preventDefault()
              void saveRubric()
            }}>
              <label className="dialog-field">
                名称
                <input
                  aria-label="名称"
                  value={form.name}
                  disabled={disabled}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label className="dialog-field">
                适用产出物
                <input
                  aria-label="适用产出物"
                  value={form.artifact}
                  disabled={disabled}
                  onChange={(event) => setForm((current) => ({ ...current, artifact: event.target.value }))}
                />
              </label>
              <label className="dialog-field">
                硬性门禁
                <textarea
                  aria-label="硬性门禁"
                  rows={3}
                  value={form.gate}
                  disabled={disabled}
                  onChange={(event) => setForm((current) => ({ ...current, gate: event.target.value }))}
                />
              </label>
              <label className="dialog-field">
                通过分数
                <input
                  aria-label="通过分数"
                  type="number"
                  min={0}
                  max={100}
                  value={form.passScore}
                  disabled={disabled}
                  onChange={(event) => setForm((current) => ({ ...current, passScore: Number(event.target.value) }))}
                />
              </label>

              <div className="rubric-dimension-editor">
                <div className="rubric-dimension-header">
                  <span>评分维度</span>
                  <strong className={totalWeight === 100 ? 'success-text' : 'danger-text'}>合计 {totalWeight}%</strong>
                </div>
                {form.dimensions.map((dimension, index) => (
                  <div className="rubric-dimension-row" key={index}>
                    <label className="dialog-field">
                      维度 {index + 1} 名称
                      <input
                        aria-label={`维度 ${index + 1} 名称`}
                        value={dimension.name}
                        disabled={disabled}
                        onChange={(event) => updateDimension(index, { name: event.target.value })}
                      />
                    </label>
                    <label className="dialog-field">
                      维度 {index + 1} 权重
                      <input
                        aria-label={`维度 ${index + 1} 权重`}
                        type="number"
                        min={1}
                        max={100}
                        value={dimension.weight}
                        disabled={disabled}
                        onChange={(event) => updateDimension(index, { weight: Number(event.target.value) })}
                      />
                    </label>
                    {form.dimensions.length > 1 && (
                      <button
                        className="button secondary"
                        type="button"
                        disabled={disabled}
                        onClick={() => setForm((current) => ({
                          ...current,
                          dimensions: current.dimensions.filter((_, dimensionIndex) => dimensionIndex !== index),
                        }))}
                      >
                        删除
                      </button>
                    )}
                  </div>
                ))}
                <button
                  className="button secondary"
                  type="button"
                  disabled={disabled}
                  onClick={() => setForm((current) => ({
                    ...current,
                    dimensions: [...current.dimensions, { name: '', weight: 1 }],
                  }))}
                >
                  <Plus size={14} />增加维度
                </button>
              </div>

              {formError && <p className="dialog-error" role="alert">{formError}</p>}
              {formFeedback && !formError && <p className="inline-feedback" role="status">{formFeedback}</p>}

              <footer>
                <button className="button secondary" type="button" onClick={closeDialog}>取消</button>
                {editingRubric && (
                  <>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={isBusy || disabled}
                      onClick={() => void publishCurrentRubric()}
                    >
                      <Send size={15} />发布版本
                    </button>
                    <button
                      className="button secondary danger-button"
                      type="button"
                      disabled={isBusy || disabled}
                      onClick={() => void deactivateCurrentRubric()}
                    >
                      <ShieldOff size={15} />停用
                    </button>
                  </>
                )}
                <button className="button primary" type="submit" disabled={isBusy || disabled}>
                  <Save size={15} />保存评分量规
                </button>
              </footer>
            </form>

            {editingRubric && (
              <div className="rubric-evaluation-runner">
                <div className="rubric-evaluation-header">
                  <div>
                    <span className="eyebrow">EVALUATION RUN</span>
                    <h3>运行评估</h3>
                  </div>
                  {evaluationResult && <span className={`status-pill ${evaluationResult.status === 'passed' ? 'success' : 'danger'}`}>{evaluationResult.status}</span>}
                </div>
                <label className="dialog-field">
                  待评估产出物
                  <textarea
                    aria-label="待评估产出物"
                    rows={4}
                    value={evaluationText}
                    disabled={disabled}
                    onChange={(event) => setEvaluationText(event.target.value)}
                  />
                </label>
                {evaluationError && <p className="dialog-error" role="alert">{evaluationError}</p>}
                <button
                  className="button primary"
                  type="button"
                  disabled={disabled || isEvaluating}
                  onClick={() => void runEvaluation()}
                >
                  <Beaker size={15} />运行评估
                </button>
                {evaluationResult && (
                  <div className="rubric-evaluation-result">
                    <strong>总分 {evaluationResult.score}</strong>
                    <span>{evaluationResult.rationale}</span>
                    {evaluationResult.dimensionScores.map((dimension) => (
                      <div key={dimension.name}>
                        <span>{dimension.name}</span>
                        <div className="weight-track"><i style={{ width: `${dimension.score}%` }} /></div>
                        <strong>{dimension.score}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {editingRubric && (
              <div className="rubric-version-list">
                <span className="eyebrow">IMMUTABLE VERSIONS</span>
                {versions.length === 0 && <p>暂无已发布版本。</p>}
                {versions.map((version) => (
                  <article key={version.id}>
                    <strong>{version.version}</strong>
                    <span>{version.snapshot.name} / 通过分 {version.snapshot.passScore}</span>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
