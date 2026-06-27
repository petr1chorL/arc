import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Beaker,
  CheckCircle2,
  FileText,
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
  createRegressionSample,
  createRegressionSampleSet,
  createRemediationTask,
  createRegressionRun,
  createRubric,
  deactivateRubric,
  evaluateRubric,
  getRegressionRun,
  getEvaluationOverview,
  getRubrics,
  listEvaluationRecords,
  listRemediationTasks,
  listRegressionRuns,
  listRegressionSampleSets,
  listRubricVersions,
  publishRubric,
  retestRemediationTask,
  updateRemediationTask,
  updateRubric,
  type RemediationTaskInput,
  type RubricInput,
} from '../api/evaluations'
import { useWorkspace } from '../auth/workspaceContextState'
import type {
  EvaluationRecord,
  EvaluationOverview,
  RemediationTask,
  RegressionRun,
  RegressionSampleSet,
  Rubric,
  RubricVersion,
} from '../types'

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

function parseBatchSamples(input: string) {
  return input
    .split(/\n+/)
    .map((sample) => sample.trim())
    .filter(Boolean)
}

interface RegressionRunComparisonChange {
  subjectId: string
  label: string
  baseStatus: string
  targetStatus: string
  baseScore: number | null
  targetScore: number | null
  targetText: string
  rationale: string
}

interface RegressionRunComparison {
  base: RegressionRun
  target: RegressionRun
  passRateDelta: number
  totalSamplesDelta: number
  passedSamplesDelta: number
  failedSamplesDelta: number
  changes: RegressionRunComparisonChange[]
}

interface RegressionRunTrendPoint {
  id: string
  label: string
  passRate: number
  failedSamples: number
  createdAt: string
  isRisk: boolean
}

interface RegressionRunTrend {
  latestPassRate: number
  previousDelta: number
  averagePassRate: number
  bestPassRate: number
  runCount: number
  points: RegressionRunTrendPoint[]
}

interface RegressionRunInsight {
  title: string
  summary: string
  recommendation: string
  tone: 'danger' | 'warning' | 'success'
  latestPassRate: number
  previousDelta: number
  riskRunCount: number
}

interface FailurePatternCluster {
  key: string
  title: string
  count: number
  averageScore: number
  weakestScore: number
  sampleIds: string[]
  recommendation: string
}

interface FailurePatternSummary {
  runId: string
  totalFailed: number
  clusters: FailurePatternCluster[]
}

interface RemediationQueueItem {
  id: string
  sourceRunId: string
  clusterKey: string
  priority: 'P0' | 'P1' | 'P2'
  title: string
  sampleCount: number
  weakestScore: number
  sampleIds: string[]
  action: string
  retestLabel: string
}

function formatDelta(value: number) {
  return value > 0 ? `+${value}` : `${value}`
}

function classifyRecordChange(baseRecord: EvaluationRecord | undefined, targetRecord: EvaluationRecord) {
  if (!baseRecord && targetRecord.status === 'failed') return '新增失败'
  if (!baseRecord && targetRecord.status === 'passed') return '新增通过'
  if (baseRecord?.status === 'failed' && targetRecord.status === 'passed') return '失败变通过'
  if (baseRecord?.status === 'passed' && targetRecord.status === 'failed') return '通过变失败'
  if (baseRecord?.status === 'failed' && targetRecord.status === 'failed') return '持续失败'
  return ''
}

function buildRegressionRunTrend(runs: RegressionRun[]): RegressionRunTrend | null {
  if (runs.length < 2) return null

  const points = [...runs]
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(-8)
    .map((run) => ({
      id: run.id,
      label: run.sampleSetName || '手动样本',
      passRate: run.passRate,
      failedSamples: run.failedSamples,
      createdAt: run.createdAt,
      isRisk: run.passRate < 70,
    }))

  const latest = points[points.length - 1]
  const previous = points[points.length - 2]
  const averagePassRate = Math.round(points.reduce((sum, point) => sum + point.passRate, 0) / points.length)
  const bestPassRate = Math.max(...points.map((point) => point.passRate))

  return {
    latestPassRate: latest.passRate,
    previousDelta: latest.passRate - previous.passRate,
    averagePassRate,
    bestPassRate,
    runCount: points.length,
    points,
  }
}

function buildRegressionRunInsight(trend: RegressionRunTrend): RegressionRunInsight {
  const latestPoint = trend.points[trend.points.length - 1]
  const riskRunCount = trend.points.filter((point) => point.isRisk).length
  const latestIsRisk = latestPoint.isRisk
  const isDeclining = trend.previousDelta < 0

  if (latestIsRisk && isDeclining) {
    return {
      title: '质量下滑',
      summary: `最新 Run 通过率低于风险线，且较上次下降 ${Math.abs(trend.previousDelta)} 点。`,
      recommendation: '建议：优先查看最新失败样本',
      tone: 'danger',
      latestPassRate: trend.latestPassRate,
      previousDelta: trend.previousDelta,
      riskRunCount,
    }
  }

  if (latestIsRisk) {
    return {
      title: '质量风险',
      summary: '最新 Run 仍低于 70% 风险线，需要先处理失败样本再扩大使用。',
      recommendation: '建议：先修复风险 Run 中的失败样本',
      tone: 'danger',
      latestPassRate: trend.latestPassRate,
      previousDelta: trend.previousDelta,
      riskRunCount,
    }
  }

  if (isDeclining) {
    return {
      title: '轻微回落',
      summary: `最新 Run 仍在风险线以上，但较上次下降 ${Math.abs(trend.previousDelta)} 点。`,
      recommendation: '建议：对比最近两次 Run，确认下降是否来自样本变化',
      tone: 'warning',
      latestPassRate: trend.latestPassRate,
      previousDelta: trend.previousDelta,
      riskRunCount,
    }
  }

  return {
    title: trend.previousDelta > 0 ? '质量改善' : '质量稳定',
    summary: trend.previousDelta > 0
      ? `最新 Run 较上次提升 ${trend.previousDelta} 点，当前趋势可继续观察。`
      : '最新 Run 与上次持平，当前趋势相对稳定。',
    recommendation: '建议：保留当前 Rubric 与样本集，继续积累回归记录',
    tone: 'success',
    latestPassRate: trend.latestPassRate,
    previousDelta: trend.previousDelta,
    riskRunCount,
  }
}

function findLatestRegressionRun(runs: RegressionRun[]): RegressionRun | null {
  if (runs.length === 0) return null

  return [...runs].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )[0]
}

function buildFailurePatternSummary(latestRun: RegressionRun | null): FailurePatternSummary | null {
  if (!latestRun) return null

  const failedRecords = (latestRun.records ?? []).filter((record) => record.status === 'failed')
  if (failedRecords.length === 0) return null

  const clusters = new Map<string, {
    title: string
    scores: number[]
    sampleIds: string[]
  }>()

  for (const record of failedRecords) {
    const weakestDimension = [...record.dimensionScores].sort((left, right) => left.score - right.score)[0]
    const key = weakestDimension?.name || '综合质量'
    const title = weakestDimension ? `${weakestDimension.name} 偏低` : '综合质量不足'
    const cluster = clusters.get(key) ?? {
      title,
      scores: [],
      sampleIds: [],
    }
    cluster.scores.push(record.score)
    cluster.sampleIds.push(record.subjectId ?? record.id)
    clusters.set(key, cluster)
  }

  return {
    runId: latestRun.id,
    totalFailed: failedRecords.length,
    clusters: Array.from(clusters.entries())
      .map(([key, cluster]) => ({
        key,
        title: cluster.title,
        count: cluster.sampleIds.length,
        averageScore: Math.round(
          cluster.scores.reduce((sum, score) => sum + score, 0) / cluster.scores.length,
        ),
        weakestScore: Math.min(...cluster.scores),
        sampleIds: cluster.sampleIds.slice(0, 3),
        recommendation: `优先补齐 ${cluster.title.replace(' 偏低', '')} 相关证据与判定依据`,
      }))
      .sort((left, right) => right.count - left.count || left.averageScore - right.averageScore)
      .slice(0, 3),
  }
}

function getRemediationPriority(cluster: FailurePatternCluster): RemediationQueueItem['priority'] {
  if (cluster.count >= 3) return 'P0'
  if (cluster.count >= 2 || cluster.weakestScore < 60) return 'P1'
  return 'P2'
}

function buildRemediationQueue(summary: FailurePatternSummary | null): RemediationQueueItem[] {
  if (!summary) return []

  const priorityRank: Record<RemediationQueueItem['priority'], number> = {
    P0: 0,
    P1: 1,
    P2: 2,
  }

  return summary.clusters
    .map((cluster) => ({
      id: `${summary.runId}:${cluster.key}`,
      sourceRunId: summary.runId,
      clusterKey: cluster.key,
      priority: getRemediationPriority(cluster),
      title: `修复 ${cluster.title}`,
      sampleCount: cluster.count,
      weakestScore: cluster.weakestScore,
      sampleIds: cluster.sampleIds,
      action: cluster.recommendation,
      retestLabel: `复测 ${cluster.count} 条代表样本`,
    }))
    .sort((left, right) => (
      priorityRank[left.priority] - priorityRank[right.priority]
      || right.sampleCount - left.sampleCount
      || left.weakestScore - right.weakestScore
    ))
}

function buildRegressionRunComparison(
  base: RegressionRun,
  target: RegressionRun,
): RegressionRunComparison {
  const baseRecords = new Map(base.records.map((record) => [record.subjectId ?? record.id, record]))
  const changes: RegressionRunComparisonChange[] = []
  for (const targetRecord of target.records) {
    const subjectId = targetRecord.subjectId ?? targetRecord.id
    const baseRecord = baseRecords.get(subjectId)
    const label = classifyRecordChange(baseRecord, targetRecord)
    if (!label) continue
    changes.push({
      subjectId,
      label,
      baseStatus: baseRecord?.status ?? 'missing',
      targetStatus: targetRecord.status,
      baseScore: baseRecord?.score ?? null,
      targetScore: targetRecord.score ?? null,
      targetText: targetRecord.artifactText,
      rationale: targetRecord.rationale,
    })
  }

  return {
    base,
    target,
    passRateDelta: target.passRate - base.passRate,
    totalSamplesDelta: target.totalSamples - base.totalSamples,
    passedSamplesDelta: target.passedSamples - base.passedSamples,
    failedSamplesDelta: target.failedSamples - base.failedSamples,
    changes,
  }
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
  const [selectedEvaluationRecord, setSelectedEvaluationRecord] = useState<EvaluationRecord | null>(null)
  const [sampleSets, setSampleSets] = useState<RegressionSampleSet[]>([])
  const [selectedSampleSetId, setSelectedSampleSetId] = useState('manual')
  const [sampleSetForm, setSampleSetForm] = useState({ name: '', description: '' })
  const [sampleForm, setSampleForm] = useState({
    sampleSetId: '',
    name: '',
    input: '',
    expectedOutput: '',
    tags: '',
  })
  const [sampleSetError, setSampleSetError] = useState('')
  const [sampleSetFeedback, setSampleSetFeedback] = useState('')
  const [isSampleSetBusy, setIsSampleSetBusy] = useState(false)
  const [batchRubricId, setBatchRubricId] = useState('')
  const [batchSamples, setBatchSamples] = useState('')
  const [batchResults, setBatchResults] = useState<EvaluationRecord[]>([])
  const [batchError, setBatchError] = useState('')
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [regressionRuns, setRegressionRuns] = useState<RegressionRun[]>([])
  const [regressionRunRubricFilter, setRegressionRunRubricFilter] = useState('all')
  const [regressionRunStatusFilter, setRegressionRunStatusFilter] = useState('all')
  const [selectedRegressionRun, setSelectedRegressionRun] = useState<RegressionRun | null>(null)
  const [regressionRunError, setRegressionRunError] = useState('')
  const [isRegressionRunLoading, setIsRegressionRunLoading] = useState(false)
  const [comparisonBaseRunId, setComparisonBaseRunId] = useState('')
  const [comparisonTargetRunId, setComparisonTargetRunId] = useState('')
  const [regressionRunComparison, setRegressionRunComparison] = useState<RegressionRunComparison | null>(null)
  const [regressionRunComparisonError, setRegressionRunComparisonError] = useState('')
  const [isRegressionRunComparisonLoading, setIsRegressionRunComparisonLoading] = useState(false)
  const [failurePatternRunDetail, setFailurePatternRunDetail] = useState<RegressionRun | null>(null)
  const [remediationTasks, setRemediationTasks] = useState<RemediationTask[]>([])
  const [remediationTaskError, setRemediationTaskError] = useState('')
  const [remediationTaskBusyId, setRemediationTaskBusyId] = useState('')

  const loadAssets = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const [
        nextOverview,
        nextRubrics,
        nextRecords,
        nextSampleSets,
        nextRegressionRuns,
        nextRemediationTasks,
      ] = await Promise.all([
        getEvaluationOverview(workspace.id),
        getRubrics(workspace.id),
        listEvaluationRecords(workspace.id),
        listRegressionSampleSets(workspace.id),
        listRegressionRuns(workspace.id).catch(() => []),
        listRemediationTasks(workspace.id).catch(() => []),
      ])
      setOverview(nextOverview)
      setRubrics(nextRubrics)
      setEvaluationRecords(nextRecords)
      setSampleSets(nextSampleSets)
      setRegressionRuns(nextRegressionRuns)
      setRemediationTasks(nextRemediationTasks)
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

  const activeRubrics = useMemo(
    () => rubrics.filter((rubric) => rubric.status === 'active'),
    [rubrics],
  )

  const selectedSampleSet = useMemo(
    () => sampleSets.find((sampleSet) => sampleSet.id === selectedSampleSetId) ?? null,
    [sampleSets, selectedSampleSetId],
  )

  const regressionRunRubricOptions = useMemo(() => {
    const options = new Map<string, string>()
    for (const run of regressionRuns) {
      options.set(run.rubricId, run.rubricName)
    }
    return Array.from(options, ([id, name]) => ({ id, name }))
  }, [regressionRuns])

  const regressionRunStatusOptions = useMemo(
    () => Array.from(new Set(regressionRuns.map((run) => run.status))),
    [regressionRuns],
  )

  const filteredRegressionRuns = useMemo(() => regressionRuns.filter((run) => (
    (regressionRunRubricFilter === 'all' || run.rubricId === regressionRunRubricFilter)
    && (regressionRunStatusFilter === 'all' || run.status === regressionRunStatusFilter)
  )), [regressionRunRubricFilter, regressionRunStatusFilter, regressionRuns])

  const regressionRunTrend = useMemo(
    () => buildRegressionRunTrend(filteredRegressionRuns),
    [filteredRegressionRuns],
  )

  const regressionRunInsight = useMemo(
    () => (regressionRunTrend ? buildRegressionRunInsight(regressionRunTrend) : null),
    [regressionRunTrend],
  )

  const latestFilteredRegressionRun = useMemo(
    () => findLatestRegressionRun(filteredRegressionRuns),
    [filteredRegressionRuns],
  )

  useEffect(() => {
    let isCancelled = false
    setFailurePatternRunDetail(null)

    if (
      !latestFilteredRegressionRun
      || latestFilteredRegressionRun.failedSamples === 0
      || (latestFilteredRegressionRun.records?.length ?? 0) > 0
    ) {
      return undefined
    }

    void getRegressionRun(workspace.id, latestFilteredRegressionRun.id)
      .then((detail) => {
        if (!isCancelled) {
          setFailurePatternRunDetail(detail)
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setFailurePatternRunDetail(null)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [latestFilteredRegressionRun, workspace.id])

  const latestRegressionRunForPatterns = failurePatternRunDetail?.id === latestFilteredRegressionRun?.id
    ? failurePatternRunDetail
    : latestFilteredRegressionRun

  const failurePatternSummary = useMemo(
    () => buildFailurePatternSummary(latestRegressionRunForPatterns),
    [latestRegressionRunForPatterns],
  )

  const remediationQueue = useMemo(
    () => buildRemediationQueue(failurePatternSummary),
    [failurePatternSummary],
  )

  const remediationTaskByQueueKey = useMemo(() => {
    const lookup = new Map<string, RemediationTask>()
    for (const task of remediationTasks) {
      lookup.set(`${task.sourceRunId}:${task.clusterKey}`, task)
    }
    return lookup
  }, [remediationTasks])

  const activeSelectedSamples = useMemo(
    () => selectedSampleSet?.samples.filter((sample) => sample.status === 'active') ?? [],
    [selectedSampleSet],
  )

  useEffect(() => {
    if (!batchRubricId && activeRubrics[0]) {
      setBatchRubricId(activeRubrics[0].id)
    }
  }, [activeRubrics, batchRubricId])

  const batchPassedCount = batchResults.filter((result) => result.status === 'passed').length
  const batchFailedCount = batchResults.length - batchPassedCount
  const batchPassRate = batchResults.length > 0
    ? Math.round((batchPassedCount / batchResults.length) * 100)
    : 0

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

  async function saveRegressionSampleSet() {
    if (!sampleSetForm.name.trim()) {
      setSampleSetError('样本集名称不能为空')
      return
    }
    setIsSampleSetBusy(true)
    setSampleSetError('')
    setSampleSetFeedback('')
    try {
      const created = await createRegressionSampleSet(workspace.id, {
        name: sampleSetForm.name.trim(),
        description: sampleSetForm.description.trim(),
      })
      setSampleSets((current) => [created, ...current])
      setSampleSetForm({ name: '', description: '' })
      setSampleForm((current) => ({ ...current, sampleSetId: created.id }))
      setSelectedSampleSetId(created.id)
      setSampleSetFeedback('样本集已创建')
    } catch (saveError) {
      setSampleSetError(saveError instanceof Error ? saveError.message : '样本集创建失败')
    } finally {
      setIsSampleSetBusy(false)
    }
  }

  async function saveRegressionSample() {
    const targetSetId = sampleForm.sampleSetId || sampleSets[0]?.id || ''
    if (!targetSetId) {
      setSampleSetError('请先创建样本集')
      return
    }
    if (!sampleForm.name.trim() || !sampleForm.input.trim() || !sampleForm.expectedOutput.trim()) {
      setSampleSetError('样本名称、输入和期望输出不能为空')
      return
    }
    setIsSampleSetBusy(true)
    setSampleSetError('')
    setSampleSetFeedback('')
    try {
      const created = await createRegressionSample(workspace.id, targetSetId, {
        name: sampleForm.name.trim(),
        input: sampleForm.input.trim(),
        expectedOutput: sampleForm.expectedOutput.trim(),
        tags: sampleForm.tags.split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      })
      setSampleSets((current) => current.map((sampleSet) => {
        if (sampleSet.id !== targetSetId) return sampleSet
        return {
          ...sampleSet,
          sampleCount: sampleSet.sampleCount + 1,
          activeSampleCount: sampleSet.activeSampleCount + (created.status === 'active' ? 1 : 0),
          samples: [...sampleSet.samples, created],
          updatedAt: created.updatedAt,
        }
      }))
      setSampleForm({
        sampleSetId: targetSetId,
        name: '',
        input: '',
        expectedOutput: '',
        tags: '',
      })
      setSampleSetFeedback('样本已加入 Golden Set')
    } catch (saveError) {
      setSampleSetError(saveError instanceof Error ? saveError.message : '样本保存失败')
    } finally {
      setIsSampleSetBusy(false)
    }
  }

  async function runBatchRegression() {
    const rubric = activeRubrics.find((candidate) => candidate.id === batchRubricId)
    const samples = selectedSampleSet
      ? activeSelectedSamples.map((sample) => ({
        id: sample.id,
        input: sample.input,
      }))
      : parseBatchSamples(batchSamples).map((sample, index) => ({
        id: `sample-${index + 1}`,
        input: sample,
      }))
    if (!rubric) {
      setBatchError('请选择可用 Rubric')
      return
    }
    if (samples.length === 0) {
      setBatchError(selectedSampleSet ? '当前样本集没有可运行样本' : '至少输入 1 条回归样本')
      return
    }

    setIsBatchRunning(true)
    setBatchError('')
    try {
      const run = await createRegressionRun(workspace.id, selectedSampleSet
        ? { rubricId: rubric.id, sampleSetId: selectedSampleSet.id }
        : {
          rubricId: rubric.id,
          samples: samples.map((sample) => ({
            input: sample.input,
            sampleId: sample.id,
          })),
        })
      const nextResults = run.records
      setBatchResults(nextResults)
      setRegressionRuns((current) => [
        run,
        ...current.filter((existingRun) => existingRun.id !== run.id),
      ])
      setEvaluationRecords((current) => [
        ...nextResults,
        ...current.filter((record) => !nextResults.some((result) => result.id === record.id)),
      ])
    } catch (batchRunError) {
      setBatchError(batchRunError instanceof Error ? batchRunError.message : '批量回归运行失败')
    } finally {
      setIsBatchRunning(false)
    }
  }

  async function openRegressionRunDetail(run: RegressionRun) {
    setIsRegressionRunLoading(true)
    setRegressionRunError('')
    try {
      const detail = await getRegressionRun(workspace.id, run.id)
      setSelectedRegressionRun(detail)
    } catch (detailError) {
      setRegressionRunError(detailError instanceof Error ? detailError.message : 'Regression Run 详情加载失败')
    } finally {
      setIsRegressionRunLoading(false)
    }
  }

  async function compareRegressionRuns() {
    if (!comparisonBaseRunId || !comparisonTargetRunId || comparisonBaseRunId === comparisonTargetRunId) {
      return
    }
    setIsRegressionRunComparisonLoading(true)
    setRegressionRunComparisonError('')
    try {
      const [base, target] = await Promise.all([
        getRegressionRun(workspace.id, comparisonBaseRunId),
        getRegressionRun(workspace.id, comparisonTargetRunId),
      ])
      setRegressionRunComparison(buildRegressionRunComparison(base, target))
    } catch (comparisonError) {
      setRegressionRunComparison(null)
      setRegressionRunComparisonError(
        comparisonError instanceof Error ? comparisonError.message : 'Regression Run 对比失败',
      )
    } finally {
      setIsRegressionRunComparisonLoading(false)
    }
  }

  function upsertRemediationTask(task: RemediationTask) {
    setRemediationTasks((current) => [
      task,
      ...current.filter((existingTask) => existingTask.id !== task.id),
    ])
  }

  async function createTaskFromQueueItem(item: RemediationQueueItem) {
    const input: RemediationTaskInput = {
      sourceRunId: item.sourceRunId,
      clusterKey: item.clusterKey,
      title: item.title,
      priority: item.priority,
      sampleIds: item.sampleIds,
      action: item.action,
    }
    setRemediationTaskBusyId(item.id)
    setRemediationTaskError('')
    try {
      upsertRemediationTask(await createRemediationTask(workspace.id, input))
    } catch (taskError) {
      setRemediationTaskError(taskError instanceof Error ? taskError.message : '修复任务创建失败')
    } finally {
      setRemediationTaskBusyId('')
    }
  }

  async function updateTaskStatus(task: RemediationTask, nextStatus: RemediationTask['status']) {
    setRemediationTaskBusyId(task.id)
    setRemediationTaskError('')
    try {
      upsertRemediationTask(await updateRemediationTask(workspace.id, task.id, nextStatus))
    } catch (taskError) {
      setRemediationTaskError(taskError instanceof Error ? taskError.message : '修复任务更新失败')
    } finally {
      setRemediationTaskBusyId('')
    }
  }

  async function startTaskRetest(task: RemediationTask) {
    setRemediationTaskBusyId(task.id)
    setRemediationTaskError('')
    try {
      upsertRemediationTask(await retestRemediationTask(workspace.id, task.id))
    } catch (taskError) {
      setRemediationTaskError(taskError instanceof Error ? taskError.message : '修复任务复测失败')
    } finally {
      setRemediationTaskBusyId('')
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
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setSelectedEvaluationRecord(record)}
                >
                  <FileText size={14} />查看详情
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel regression-sample-sets">
        <header>
          <div>
            <span className="eyebrow">GOLDEN SET</span>
            <h2>Regression Sample Sets</h2>
          </div>
          <span className="status-pill">{sampleSets.length} 个样本集</span>
        </header>
        <div className="sample-set-layout">
          <div className="sample-set-list">
            {sampleSets.length === 0 && (
              <div className="table-state">暂无回归样本集。先创建一个 Golden Set，再把高价值样本加入进去。</div>
            )}
            {sampleSets.map((sampleSet) => (
              <article className="sample-set-card" key={sampleSet.id}>
                <div>
                  <span className="mono">{sampleSet.id}</span>
                  <h3>{sampleSet.name}</h3>
                  <p>{sampleSet.description || '未填写说明'}</p>
                </div>
                <div className="sample-set-meta">
                  <span className="status-pill success">{sampleSet.status}</span>
                  <strong>{sampleSet.activeSampleCount} / {sampleSet.sampleCount}</strong>
                </div>
                {sampleSet.samples.length > 0 && (
                  <div className="sample-chip-list">
                    {sampleSet.samples.slice(0, 4).map((sample) => (
                      <span key={sample.id}>{sample.name}</span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
          <div className="sample-set-editor">
            <div className="sample-set-form">
              <label className="dialog-field">
                样本集名称
                <input
                  aria-label="样本集名称"
                  value={sampleSetForm.name}
                  disabled={isSampleSetBusy}
                  onChange={(event) => setSampleSetForm((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label className="dialog-field">
                样本集说明
                <textarea
                  aria-label="样本集说明"
                  rows={2}
                  value={sampleSetForm.description}
                  disabled={isSampleSetBusy}
                  onChange={(event) => setSampleSetForm((current) => ({ ...current, description: event.target.value }))}
                />
              </label>
              <button
                className="button secondary"
                type="button"
                disabled={isSampleSetBusy}
                onClick={() => void saveRegressionSampleSet()}
              >
                <Plus size={14} />创建样本集
              </button>
            </div>
            <div className="sample-set-form">
              <label className="dialog-field">
                加入到
                <select
                  aria-label="加入到样本集"
                  value={sampleForm.sampleSetId || sampleSets[0]?.id || ''}
                  disabled={sampleSets.length === 0 || isSampleSetBusy}
                  onChange={(event) => setSampleForm((current) => ({ ...current, sampleSetId: event.target.value }))}
                >
                  {sampleSets.length === 0 && <option value="">暂无样本集</option>}
                  {sampleSets.map((sampleSet) => (
                    <option key={sampleSet.id} value={sampleSet.id}>{sampleSet.name}</option>
                  ))}
                </select>
              </label>
              <label className="dialog-field">
                样本名称
                <input
                  aria-label="样本名称"
                  value={sampleForm.name}
                  disabled={isSampleSetBusy}
                  onChange={(event) => setSampleForm((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label className="dialog-field">
                样本输入
                <textarea
                  aria-label="样本输入"
                  rows={3}
                  value={sampleForm.input}
                  disabled={isSampleSetBusy}
                  onChange={(event) => setSampleForm((current) => ({ ...current, input: event.target.value }))}
                />
              </label>
              <label className="dialog-field">
                期望输出
                <textarea
                  aria-label="期望输出"
                  rows={3}
                  value={sampleForm.expectedOutput}
                  disabled={isSampleSetBusy}
                  onChange={(event) => setSampleForm((current) => ({ ...current, expectedOutput: event.target.value }))}
                />
              </label>
              <label className="dialog-field">
                标签
                <input
                  aria-label="样本标签"
                  placeholder="evidence, launch"
                  value={sampleForm.tags}
                  disabled={isSampleSetBusy}
                  onChange={(event) => setSampleForm((current) => ({ ...current, tags: event.target.value }))}
                />
              </label>
              {sampleSetError && <p className="dialog-error" role="alert">{sampleSetError}</p>}
              {sampleSetFeedback && !sampleSetError && <p className="inline-feedback" role="status">{sampleSetFeedback}</p>}
              <button
                className="button primary"
                type="button"
                disabled={isSampleSetBusy || sampleSets.length === 0}
                onClick={() => void saveRegressionSample()}
              >
                <Save size={14} />加入样本
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel batch-regression">
        <header>
          <div>
            <span className="eyebrow">BATCH REGRESSION</span>
            <h2>批量回归</h2>
          </div>
          {batchResults.length > 0 && (
            <span className={`status-pill ${batchFailedCount === 0 ? 'success' : 'danger'}`}>
              通过率 {batchPassRate}%
            </span>
          )}
        </header>
        <div className="batch-regression-layout">
          <div className="batch-regression-form">
            <label className="dialog-field">
              回归 Rubric
              <select
                aria-label="回归 Rubric"
                value={batchRubricId}
                disabled={activeRubrics.length === 0 || isBatchRunning}
                onChange={(event) => setBatchRubricId(event.target.value)}
              >
                {activeRubrics.length === 0 && <option value="">暂无可用 Rubric</option>}
                {activeRubrics.map((rubric) => (
                  <option key={rubric.id} value={rubric.id}>{rubric.name} / {rubric.version}</option>
                ))}
              </select>
            </label>
            <label className="dialog-field">
              Golden Set
              <select
                aria-label="Golden Set"
                value={selectedSampleSetId}
                disabled={isBatchRunning}
                onChange={(event) => setSelectedSampleSetId(event.target.value)}
              >
                <option value="manual">手动输入样本</option>
                {sampleSets.map((sampleSet) => (
                  <option key={sampleSet.id} value={sampleSet.id}>
                    {sampleSet.name} / {sampleSet.activeSampleCount} 条
                  </option>
                ))}
              </select>
            </label>
            <label className="dialog-field">
              回归样本
              <textarea
                aria-label="回归样本"
                rows={5}
                placeholder="每行一条样本。运行后会逐条生成 Evaluation Record。"
                value={batchSamples}
                disabled={isBatchRunning || selectedSampleSetId !== 'manual'}
                onChange={(event) => setBatchSamples(event.target.value)}
              />
              {selectedSampleSet && (
                <small>将运行 {selectedSampleSet.name} 中的 {activeSelectedSamples.length} 条 active 样本。</small>
              )}
            </label>
            {batchError && <p className="dialog-error" role="alert">{batchError}</p>}
            <button
              className="button primary"
              data-testid="run-batch-regression"
              type="button"
              disabled={isBatchRunning || activeRubrics.length === 0}
              onClick={() => void runBatchRegression()}
            >
              <Beaker size={15} />{isBatchRunning ? '运行中' : '运行批量回归'}
            </button>
          </div>
          <div className="batch-regression-output">
            {batchResults.length === 0 && (
              <div className="table-state">选择 Rubric 并输入样本后，可以一次性验证当前量规是否稳定。</div>
            )}
            {batchResults.length > 0 && (
              <>
                <div className="batch-regression-summary">
                  <strong>通过率 {batchPassRate}%</strong>
                  <span>{batchResults.length} 条样本</span>
                  <span>{batchPassedCount} 条通过</span>
                  <span>{batchFailedCount} 条失败</span>
                </div>
                <div className="batch-regression-results">
                  {batchResults.map((result, index) => (
                    <article className="batch-regression-result" key={result.id}>
                      <div>
                        <span className="mono">{result.id}</span>
                        <h3>样本 #{index + 1}</h3>
                        {result.subjectId && <span className="mono">{result.subjectId}</span>}
                        <p>{result.artifactText}</p>
                      </div>
                      <div className="evaluation-record-score">
                        <strong>{result.score}</strong>
                        <span className={`status-pill ${result.status === 'passed' ? 'success' : 'danger'}`}>
                          {result.status}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="panel regression-run-history">
        <header>
          <div>
            <span className="eyebrow">REGRESSION RUNS</span>
            <h2>Regression Run History</h2>
          </div>
          <span className="status-pill">{filteredRegressionRuns.length} / {regressionRuns.length} runs</span>
        </header>
        {regressionRuns.length > 0 && (
          <div className="regression-run-filters">
            <label>
              Run Rubric 筛选
              <select
                aria-label="Run Rubric 筛选"
                value={regressionRunRubricFilter}
                onChange={(event) => setRegressionRunRubricFilter(event.target.value)}
              >
                <option value="all">全部 Rubric</option>
                {regressionRunRubricOptions.map((rubric) => (
                  <option key={rubric.id} value={rubric.id}>{rubric.name}</option>
                ))}
              </select>
            </label>
            <label>
              Run 状态筛选
              <select
                aria-label="Run 状态筛选"
                value={regressionRunStatusFilter}
                onChange={(event) => setRegressionRunStatusFilter(event.target.value)}
              >
                <option value="all">全部状态</option>
                {regressionRunStatusOptions.map((statusOption) => (
                  <option key={statusOption} value={statusOption}>{statusOption}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        {regressionRunTrend && (
          <div className="regression-run-trend" role="region" aria-label="Regression Run Trend">
            <header>
              <div>
                <span className="eyebrow">REGRESSION RUN TREND</span>
                <h3>Regression Run Trend</h3>
              </div>
              <span className="status-pill">{regressionRunTrend.runCount} runs</span>
            </header>
            {regressionRunInsight && (
              <div
                className={`regression-run-insight ${regressionRunInsight.tone}`}
                role="region"
                aria-label="Regression Run Insight"
              >
                <div>
                  <span className="eyebrow">QUALITY INSIGHT</span>
                  <h4>{regressionRunInsight.title}</h4>
                  <p>{regressionRunInsight.summary}</p>
                </div>
                <div className="insight-facts">
                  <span>
                    <small>最新通过率</small>
                    <strong>最新通过率 {regressionRunInsight.latestPassRate}%</strong>
                  </span>
                  <span>
                    <small>较上次</small>
                    <strong>较上次 {formatDelta(regressionRunInsight.previousDelta)}</strong>
                  </span>
                  <span>
                    <small>风险 Run</small>
                    <strong>风险 Run {regressionRunInsight.riskRunCount} 个</strong>
                  </span>
                </div>
                <p className="insight-recommendation">{regressionRunInsight.recommendation}</p>
              </div>
            )}
            {failurePatternSummary && (
              <div className="failure-pattern-summary" role="region" aria-label="Failure Pattern Summary">
                <header>
                  <div>
                    <span className="eyebrow">FAILURE PATTERNS</span>
                    <h4>Failure Pattern Summary</h4>
                  </div>
                  <span className="status-pill">最新失败样本 {failurePatternSummary.totalFailed} 条</span>
                </header>
                <div className="failure-cluster-list">
                  {failurePatternSummary.clusters.map((cluster) => (
                    <article className="failure-cluster-card" key={cluster.key}>
                      <div>
                        <h5>{cluster.title}</h5>
                        <p>{cluster.count} {cluster.count === 1 ? 'sample' : 'samples'}</p>
                      </div>
                      <div className="cluster-score">
                        <span>平均分 {cluster.averageScore}</span>
                        <span>最低分 {cluster.weakestScore}</span>
                      </div>
                      <div className="cluster-samples">
                        {cluster.sampleIds.map((sampleId) => (
                          <span className="mono" key={sampleId}>{sampleId}</span>
                        ))}
                      </div>
                      <p>{cluster.recommendation}</p>
                    </article>
                  ))}
                </div>
              </div>
            )}
            {remediationQueue.length > 0 && (
              <div className="remediation-queue" role="region" aria-label="Failure Remediation Queue">
                <header>
                  <div>
                    <span className="eyebrow">REMEDIATION QUEUE</span>
                    <h4>Failure Remediation Queue</h4>
                  </div>
                  <span className="status-pill">{remediationQueue.length} 个修复项</span>
                </header>
                {remediationTaskError && (
                  <div className="inline-feedback error" role="alert">{remediationTaskError}</div>
                )}
                <div className="remediation-item-list">
                  {remediationQueue.map((item) => {
                    const existingTask = remediationTaskByQueueKey.get(item.id)
                    const isBusy = remediationTaskBusyId === item.id
                    return (
                      <article className="remediation-item-card" key={item.id}>
                        <div className="remediation-item-heading">
                          <span className={`remediation-priority ${item.priority.toLowerCase()}`}>
                            {item.priority}
                          </span>
                          <div>
                            <h5>{item.title}</h5>
                            <p>{item.sampleCount} samples · 最低分 {item.weakestScore}</p>
                          </div>
                        </div>
                        <p>{item.action}</p>
                        <div className="remediation-samples">
                          {item.sampleIds.map((sampleId) => (
                            <span className="mono" key={sampleId}>{sampleId}</span>
                          ))}
                        </div>
                        <div className="remediation-item-footer">
                          <span className="remediation-retest">{item.retestLabel}</span>
                          <button
                            className="button secondary small"
                            type="button"
                            disabled={Boolean(existingTask) || isBusy}
                            onClick={() => void createTaskFromQueueItem(item)}
                          >
                            {existingTask ? '已创建任务' : '创建任务'}
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>
            )}
            {remediationTasks.length > 0 && (
              <div className="remediation-task-board" role="region" aria-label="Remediation Tasks">
                <header>
                  <div>
                    <span className="eyebrow">REMEDIATION TASKS</span>
                    <h4>Remediation Tasks</h4>
                  </div>
                  <span className="status-pill">{remediationTasks.length} 个任务</span>
                </header>
                <div className="remediation-task-list">
                  {remediationTasks.map((task) => (
                    <article className="remediation-task-card" key={task.id}>
                      <div>
                        <span className={`remediation-priority ${task.priority.toLowerCase()}`}>
                          {task.priority}
                        </span>
                        <strong>{task.title}</strong>
                      </div>
                      <p>{task.action}</p>
                      <div className="remediation-task-meta">
                        <span>{task.status}</span>
                        <span>{task.sampleIds.length} samples</span>
                        <span className="mono">{task.clusterKey}</span>
                      </div>
                      <div className="remediation-task-actions">
                        <button
                          className="button secondary small"
                          type="button"
                          disabled={task.status !== 'open' || remediationTaskBusyId === task.id}
                          onClick={() => void updateTaskStatus(task, 'in_progress')}
                        >
                          标记处理中
                        </button>
                        <button
                          className="button secondary small"
                          type="button"
                          disabled={task.status === 'done' || remediationTaskBusyId === task.id}
                          onClick={() => void updateTaskStatus(task, 'done')}
                        >
                          标记完成
                        </button>
                        {task.status === 'done' && !task.retestRunId && (
                          <button
                            className="button secondary small"
                            type="button"
                            disabled={remediationTaskBusyId === task.id}
                            onClick={() => void startTaskRetest(task)}
                          >
                            发起复测
                          </button>
                        )}
                      </div>
                      {task.retestRun && (
                        <div className="remediation-retest-result">
                          <span>Retest Run</span>
                          <strong className="mono">{task.retestRun.id}</strong>
                          <em>通过率 {task.retestRun.passRate}%</em>
                          <em>失败 {task.retestRun.failedSamples}</em>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )}
            <div className="trend-metrics">
              <div>
                <span>最新通过率</span>
                <strong>最新通过率 {regressionRunTrend.latestPassRate}%</strong>
              </div>
              <div>
                <span>较上次</span>
                <strong>较上次 {formatDelta(regressionRunTrend.previousDelta)}</strong>
              </div>
              <div>
                <span>平均通过率</span>
                <strong>平均通过率 {regressionRunTrend.averagePassRate}%</strong>
              </div>
              <div>
                <span>最佳通过率</span>
                <strong>最佳通过率 {regressionRunTrend.bestPassRate}%</strong>
              </div>
            </div>
            <div className="trend-bars" aria-label="Regression Run pass rate trend">
              {regressionRunTrend.points.map((point, index) => (
                <article
                  aria-label={`Regression Run ${point.id} pass rate ${point.passRate}%`}
                  className={`trend-bar-card ${point.isRisk ? 'risk' : ''}`}
                  key={point.id}
                >
                  <div className="trend-bar-shell">
                    <span className="trend-bar-fill" style={{ height: `${Math.max(point.passRate, 4)}%` }} />
                  </div>
                  <div>
                    <span className="mono">Run {index + 1}</span>
                    <strong>{point.passRate}%</strong>
                    <small>{point.failedSamples} failed</small>
                    {point.isRisk && <em>风险</em>}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
        {regressionRuns.length > 1 && (
          <div className="regression-run-comparison-controls">
            <label>
              基准 Run
              <select
                aria-label="基准 Run"
                value={comparisonBaseRunId}
                onChange={(event) => setComparisonBaseRunId(event.target.value)}
              >
                <option value="">选择基准 Run</option>
                {regressionRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.id} · {run.passRate}%
                  </option>
                ))}
              </select>
            </label>
            <label>
              目标 Run
              <select
                aria-label="目标 Run"
                value={comparisonTargetRunId}
                onChange={(event) => setComparisonTargetRunId(event.target.value)}
              >
                <option value="">选择目标 Run</option>
                {regressionRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.id} · {run.passRate}%
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button secondary"
              type="button"
              disabled={
                isRegressionRunComparisonLoading
                || !comparisonBaseRunId
                || !comparisonTargetRunId
                || comparisonBaseRunId === comparisonTargetRunId
              }
              onClick={() => void compareRegressionRuns()}
            >
              <ArrowRight size={14} />对比 Run
            </button>
          </div>
        )}
        {regressionRunComparisonError && (
          <div className="inline-feedback error" role="alert">{regressionRunComparisonError}</div>
        )}
        {regressionRunComparison && (
          <div className="regression-run-comparison" role="region" aria-label="Regression Run Comparison">
            <header>
              <div>
                <span className="eyebrow">REGRESSION RUN COMPARISON</span>
                <h3>Regression Run Comparison</h3>
                <p>
                  <span className="mono">{regressionRunComparison.base.id}</span>
                  <ArrowRight size={13} />
                  <span className="mono">{regressionRunComparison.target.id}</span>
                </p>
              </div>
            </header>
            <div className="comparison-metrics">
              <div>
                <span>通过率变化</span>
                <strong>通过率变化 {formatDelta(regressionRunComparison.passRateDelta)}</strong>
              </div>
              <div>
                <span>通过样本变化</span>
                <strong>{formatDelta(regressionRunComparison.passedSamplesDelta)}</strong>
              </div>
              <div>
                <span>失败样本变化</span>
                <strong>失败样本变化 {formatDelta(regressionRunComparison.failedSamplesDelta)}</strong>
              </div>
              <div>
                <span>总样本变化</span>
                <strong>{formatDelta(regressionRunComparison.totalSamplesDelta)}</strong>
              </div>
            </div>
            {regressionRunComparison.changes.length === 0 && (
              <div className="table-state">两次 Run 暂无需要关注的样本状态变化。</div>
            )}
            {regressionRunComparison.changes.length > 0 && (
              <div className="comparison-change-list">
                {regressionRunComparison.changes.map((change) => (
                  <article className="comparison-change-card" key={`${change.subjectId}-${change.label}`}>
                    <div>
                      <span className="mono">{change.subjectId}</span>
                      <h4>{change.label}</h4>
                      <p>{change.targetText}</p>
                    </div>
                    <div>
                      <span className={`status-pill ${change.label === '失败变通过' ? 'success' : 'danger'}`}>
                        {change.baseStatus} → {change.targetStatus}
                      </span>
                      <strong>
                        {change.baseScore ?? '-'} → {change.targetScore ?? '-'}
                      </strong>
                    </div>
                    <p>{change.rationale}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
        {regressionRunError && <div className="inline-feedback error" role="alert">{regressionRunError}</div>}
        {regressionRuns.length === 0 && (
          <div className="table-state">暂无 Regression Run。运行一次批量回归后，这里会保留运行摘要和关联 Evaluation。</div>
        )}
        {regressionRuns.length > 0 && filteredRegressionRuns.length === 0 && (
          <div className="table-state">当前筛选条件下暂无 Regression Run。</div>
        )}
        {regressionRuns.length > 0 && (
          <div className="regression-run-list">
            {filteredRegressionRuns.map((run) => (
              <article className="regression-run-card" key={run.id}>
                <div>
                  <span className="mono">{run.id}</span>
                  <h3>{run.sampleSetName || '手动样本'}</h3>
                  <p>{run.rubricName} / {run.rubricVersion}</p>
                </div>
                <div className="regression-run-score">
                  <strong>通过率 {run.passRate}%</strong>
                  <span className={`status-pill ${run.failedSamples === 0 ? 'success' : 'danger'}`}>
                    {run.status}
                  </span>
                </div>
                <div className="regression-run-summary">
                  <span>{run.totalSamples} samples</span>
                  <span>{run.passedSamples} passed</span>
                  <span>{run.failedSamples} failed</span>
                  <span>{run.evaluationIds.length} evaluations</span>
                </div>
                <div className="regression-run-actions">
                  <p>{new Date(run.createdAt).toLocaleString()}</p>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={isRegressionRunLoading}
                    onClick={() => void openRegressionRunDetail(run)}
                  >
                    <FileText size={14} />查看 Run 详情
                  </button>
                </div>
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

      {selectedEvaluationRecord && (
        <div className="dialog-backdrop">
          <section
            className="agent-dialog evaluation-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evaluation-detail-title"
          >
            <header>
              <div>
                <p className="eyebrow">EVALUATION DETAIL</p>
                <h2 id="evaluation-detail-title">评估详情</h2>
              </div>
              <button
                className="icon-button quiet"
                type="button"
                title="关闭"
                onClick={() => setSelectedEvaluationRecord(null)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="evaluation-detail-summary">
              <div>
                <span>记录 ID</span>
                <strong className="mono">{selectedEvaluationRecord.id}</strong>
              </div>
              <div>
                <span>总分</span>
                <strong>{selectedEvaluationRecord.score}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong>{selectedEvaluationRecord.status}</strong>
              </div>
              <div>
                <span>创建时间</span>
                <strong>{selectedEvaluationRecord.createdAt}</strong>
              </div>
            </div>

            <div className="evaluation-detail-grid">
              <section className="evaluation-detail-section">
                <span className="eyebrow">SUBJECT</span>
                <h3>评估对象</h3>
                <p>{selectedEvaluationRecord.subjectType}{selectedEvaluationRecord.subjectId ? ` / ${selectedEvaluationRecord.subjectId}` : ''}</p>
              </section>
              <section className="evaluation-detail-section">
                <span className="eyebrow">RUBRIC SNAPSHOT</span>
                <h3>Rubric 快照</h3>
                <div className="evaluation-detail-facts">
                  <span>名称</span>
                  <strong>{selectedEvaluationRecord.rubricSnapshot.name} / {selectedEvaluationRecord.rubricVersion}</strong>
                  <span>适用产出物</span>
                  <strong>{selectedEvaluationRecord.rubricSnapshot.artifact}</strong>
                  <span>硬性门禁</span>
                  <strong>{selectedEvaluationRecord.rubricSnapshot.gate}</strong>
                  <span>通过阈值</span>
                  <strong>{selectedEvaluationRecord.rubricSnapshot.passScore}</strong>
                </div>
              </section>
            </div>

            <section className="evaluation-detail-section">
              <span className="eyebrow">DIMENSION SCORES</span>
              <h3>维度评分</h3>
              <div className="evaluation-detail-dimensions">
                {selectedEvaluationRecord.dimensionScores.map((dimension) => (
                  <article key={dimension.name}>
                    <strong>{dimension.name}</strong>
                    <span>权重 {dimension.weight}%</span>
                    <span>得分 {dimension.score}</span>
                  </article>
                ))}
              </div>
            </section>

            <section className="evaluation-detail-section">
              <span className="eyebrow">ARTIFACT TEXT</span>
              <h3>待评估产出物</h3>
              <p className="evaluation-detail-copy">{selectedEvaluationRecord.artifactText}</p>
            </section>

            <section className="evaluation-detail-section">
              <span className="eyebrow">RATIONALE</span>
              <h3>评分说明</h3>
              <p>{selectedEvaluationRecord.rationale}</p>
            </section>
          </section>
        </div>
      )}

      {selectedRegressionRun && (
        <div className="dialog-backdrop">
          <section
            className="agent-dialog regression-run-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="regression-run-detail-title"
          >
            <header>
              <div>
                <p className="eyebrow">REGRESSION RUN DETAIL</p>
                <h2 id="regression-run-detail-title">Regression Run Detail</h2>
              </div>
              <button
                className="icon-button quiet"
                type="button"
                title="关闭"
                onClick={() => setSelectedRegressionRun(null)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="evaluation-detail-summary">
              <div>
                <span>Run ID</span>
                <strong className="mono">{selectedRegressionRun.id}</strong>
              </div>
              <div>
                <span>通过率</span>
                <strong>{selectedRegressionRun.passRate}%</strong>
              </div>
              <div>
                <span>样本</span>
                <strong>{selectedRegressionRun.totalSamples}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong>{selectedRegressionRun.status}</strong>
              </div>
            </div>

            <section className="evaluation-detail-section">
              <span className="eyebrow">RUN CONTEXT</span>
              <h3>运行上下文</h3>
              <div className="evaluation-detail-facts">
                <span>样本集</span>
                <strong>{selectedRegressionRun.sampleSetName || '手动样本'}</strong>
                <span>Rubric</span>
                <strong>{selectedRegressionRun.rubricName} / {selectedRegressionRun.rubricVersion}</strong>
                <span>通过 / 失败</span>
                <strong>{selectedRegressionRun.passedSamples} / {selectedRegressionRun.failedSamples}</strong>
                <span>完成时间</span>
                <strong>{selectedRegressionRun.completedAt}</strong>
              </div>
            </section>

            <section className="evaluation-detail-section">
              <span className="eyebrow">SAMPLE EVALUATIONS</span>
              <h3>样本级评估</h3>
              {selectedRegressionRun.records.length === 0 && (
                <div className="table-state">该 Run 暂无可展示的 Evaluation 记录。</div>
              )}
              {selectedRegressionRun.records.length > 0 && (
                <div className="regression-run-record-list">
                  {selectedRegressionRun.records.map((record) => (
                    <article className="regression-run-record-card" key={record.id}>
                      <div>
                        <span className="mono">{record.id}</span>
                        <h4>{record.subjectId ?? record.subjectType}</h4>
                        <p>{record.artifactText}</p>
                      </div>
                      <div className="evaluation-record-score">
                        <strong>{record.score}</strong>
                        <span className={`status-pill ${record.status === 'passed' ? 'success' : 'danger'}`}>
                          {record.status}
                        </span>
                      </div>
                      <p>{record.rationale}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>
        </div>
      )}
    </div>
  )
}
