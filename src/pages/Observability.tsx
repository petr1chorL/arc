import {
  BarChart3,
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Clock3,
  Coins,
  ListChecks,
  RefreshCw,
  Route,
  ShieldAlert,
  TimerReset,
  UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { listExecutionJobs } from '../api/execution'
import {
  getCostUsageOverview,
  getHumanSlaOverview,
  getObservabilityOverview,
  getObservabilityRunDetail,
} from '../api/observability'
import { useWorkspace } from '../auth/workspaceContextState'
import { StatusBadge } from '../components/StatusBadge'
import { displayStatus } from '../domain/statusText'
import type {
  CostUsageGroup,
  CostUsageOverview,
  ExecutionJob,
  HumanSlaOverview,
  HumanSlaRisk,
  ObservabilityAlert,
  ObservabilityOverview,
  ObservabilityRisk,
  ObservabilityRunDetail,
  ObservabilityExecutionEvent,
  ObservabilityRunSummary,
} from '../types'

function formatDuration(durationMs: number) {
  if (durationMs <= 0) return '0 ms'
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(2)} s`
}

function formatOptionalDuration(durationMs: number | null) {
  return formatDuration(durationMs ?? 0)
}

function formatCost(value: number) {
  return `$${value.toFixed(4)}`
}

function formatTime(value: string | null) {
  if (!value) return '未完成'
  return new Date(value).toLocaleString('zh-CN')
}

function executionJobStatusLabel(status: string) {
  return {
    queued: '排队中',
    running: '运行中',
    succeeded: '已完成',
    dead_letter: '死信',
  }[status] ?? status
}

function runTitle(run: ObservabilityRunSummary) {
  return run.workflowName
}

function riskMessage(risk: ObservabilityRisk, runs: ObservabilityRunSummary[]) {
  const relatedRun = runs.find((run) => run.id === risk.runId)
  const [status = '', node = '未知节点'] = risk.message.split(' · ')
  return `${displayStatus(relatedRun?.status ?? status)} · ${relatedRun?.currentNode || node}`
}

const runStatusOptions = ['全部', '失败', '需介入', '恢复失败', '已完成']
const riskOptions = [
  { label: '全部风险', value: 'all' },
  { label: '高风险', value: 'critical' },
  { label: '中风险', value: 'warning' },
  { label: '普通', value: 'normal' },
]
const failureOptions = [
  { label: '全部原因', value: 'all' },
  { label: '连接器鉴权超时', value: 'connector_auth_timeout' },
  { label: '模型调用失败', value: 'model_call_failed' },
  { label: '等待人工审核', value: 'human_review_blocked' },
  { label: '恢复执行失败', value: 'resume_failed' },
  { label: '质量门禁未通过', value: 'quality_gate_failed' },
  { label: '未知异常', value: 'unknown' },
  { label: '无异常', value: 'normal' },
]

export function Observability() {
  const { workspace, workspacePath } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const [overview, setOverview] = useState<ObservabilityOverview | null>(null)
  const [selectedRunId, setSelectedRunId] = useState('')
  const [detail, setDetail] = useState<ObservabilityRunDetail | null>(null)
  const [humanSla, setHumanSla] = useState<HumanSlaOverview | null>(null)
  const [costUsage, setCostUsage] = useState<CostUsageOverview | null>(null)
  const [executionJobs, setExecutionJobs] = useState<ExecutionJob[]>([])
  const [reviewerId, setReviewerId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [isHumanSlaLoading, setIsHumanSlaLoading] = useState(true)
  const [isCostUsageLoading, setIsCostUsageLoading] = useState(true)
  const [isExecutionJobsLoading, setIsExecutionJobsLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [humanSlaError, setHumanSlaError] = useState('')
  const [costUsageError, setCostUsageError] = useState('')
  const [executionJobsError, setExecutionJobsError] = useState('')
  const statusFilter = searchParams.get('status') || '全部'
  const workflowFilter = searchParams.get('workflow') || ''
  const riskFilter = searchParams.get('risk') || 'all'
  const failureFilter = searchParams.get('failure') || 'all'
  const requestedRunId = searchParams.get('runId') || ''

  const writeSearchParams = useCallback((updates: Record<string, string>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      Object.entries(updates).forEach(([key, value]) => {
        if (
          !value
          || (key === 'status' && value === '全部')
          || (key === 'risk' && value === 'all')
          || (key === 'failure' && value === 'all')
        ) {
          next.delete(key)
        } else {
          next.set(key, value)
        }
      })
      return next
    }, { replace: true })
  }, [setSearchParams])

  const candidateRuns = useMemo(() => {
    if (!overview) return []
    const seen = new Set<string>()
    return overview.recentRuns.filter((run) => {
      if (seen.has(run.id)) return false
      seen.add(run.id)
      return true
    })
  }, [overview])

  const filteredRuns = useMemo(() => {
    const workflowNeedle = workflowFilter.trim().toLowerCase()
    return candidateRuns.filter((run) => {
      const matchesStatus = statusFilter === '全部' || displayStatus(run.status) === statusFilter
      const matchesWorkflow = !workflowNeedle || run.workflowName.toLowerCase().includes(workflowNeedle)
      const matchesRisk = riskFilter === 'all' || run.priority === riskFilter
      const matchesFailure = failureFilter === 'all' || run.failureCategory === failureFilter
      return matchesStatus && matchesWorkflow && matchesRisk && matchesFailure
    })
  }, [candidateRuns, failureFilter, riskFilter, statusFilter, workflowFilter])

  const filteredRisks = useMemo(() => {
    if (!overview) return []
    const visibleRunIds = new Set(filteredRuns.map((run) => run.id))
    return overview.risks.filter((risk) => (
      visibleRunIds.has(risk.runId)
      && (riskFilter === 'all' || risk.severity === riskFilter)
    ))
  }, [filteredRuns, overview, riskFilter])

  const filteredAlerts = useMemo(() => {
    if (!overview) return []
    const visibleRunIds = new Set(filteredRuns.map((run) => run.id))
    return (overview.alerts ?? []).filter((alert) => !alert.runId || visibleRunIds.has(alert.runId))
  }, [filteredRuns, overview])

  const loadOverview = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const nextOverview = await getObservabilityOverview(workspace.id)
      setOverview(nextOverview)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '运行观测数据加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [workspace.id])

  const loadHumanSla = useCallback(async () => {
    setIsHumanSlaLoading(true)
    setHumanSlaError('')
    try {
      setHumanSla(await getHumanSlaOverview(workspace.id, {
        reviewerId: reviewerId || undefined,
        groupId: groupId || undefined,
      }))
    } catch (loadError) {
      setHumanSla(null)
      setHumanSlaError(loadError instanceof Error ? loadError.message : '人工 SLA 数据加载失败')
    } finally {
      setIsHumanSlaLoading(false)
    }
  }, [groupId, reviewerId, workspace.id])

  const loadCostUsage = useCallback(async () => {
    setIsCostUsageLoading(true)
    setCostUsageError('')
    try {
      setCostUsage(await getCostUsageOverview(workspace.id))
    } catch (loadError) {
      setCostUsage(null)
      setCostUsageError(loadError instanceof Error ? loadError.message : '成本与模型调用数据加载失败')
    } finally {
      setIsCostUsageLoading(false)
    }
  }, [workspace.id])

  const loadExecutionJobs = useCallback(async () => {
    setIsExecutionJobsLoading(true)
    setExecutionJobsError('')
    try {
      setExecutionJobs(await listExecutionJobs(workspace.id))
    } catch (loadError) {
      setExecutionJobs([])
      setExecutionJobsError(loadError instanceof Error ? loadError.message : '队列任务加载失败')
    } finally {
      setIsExecutionJobsLoading(false)
    }
  }, [workspace.id])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    void loadHumanSla()
  }, [loadHumanSla])

  useEffect(() => {
    void loadCostUsage()
  }, [loadCostUsage])

  useEffect(() => {
    void loadExecutionJobs()
  }, [loadExecutionJobs])

  useEffect(() => {
    if (!overview) return
    setSelectedRunId((current) => {
      const visibleRunIds = new Set(filteredRuns.map((run) => run.id))
      if (requestedRunId && visibleRunIds.has(requestedRunId)) return requestedRunId
      if (current && visibleRunIds.has(current)) return current
      const firstRiskRun = filteredRuns.find((run) => filteredRisks.some((risk) => risk.runId === run.id))
      return firstRiskRun?.id ?? filteredRuns[0]?.id ?? ''
    })
  }, [filteredRisks, filteredRuns, overview, requestedRunId])

  useEffect(() => {
    if (!selectedRunId) return
    if (searchParams.get('runId') === selectedRunId) return
    writeSearchParams({ runId: selectedRunId })
  }, [searchParams, selectedRunId, writeSearchParams])

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null)
      setDetailError('')
      return
    }

    setIsDetailLoading(true)
    setDetailError('')
    void getObservabilityRunDetail(workspace.id, selectedRunId)
      .then(setDetail)
      .catch((loadError) => {
        setDetail(null)
        setDetailError(loadError instanceof Error ? loadError.message : '运行详情加载失败')
      })
      .finally(() => setIsDetailLoading(false))
  }, [selectedRunId, workspace.id])

  if (isLoading) {
    return <div className="panel table-state">正在加载运行观测数据...</div>
  }

  if (error) {
    return (
      <div className="panel table-state error" role="alert">
        {error}
        <button className="button secondary" onClick={() => void loadOverview()}>
          <RefreshCw size={15} />重试
        </button>
      </div>
    )
  }

  if (!overview || candidateRuns.length === 0) {
    return (
      <section className="panel observability-empty">
        <ShieldAlert size={26} />
        <h2>暂无运行记录</h2>
        <p>运行工作流或 Agent 后，这里会显示失败、人工介入和成本风险。</p>
        <Link className="button primary" to={workspacePath('workflows')}>
          去编排工作流 <ArrowRight size={15} />
        </Link>
      </section>
    )
  }

  return (
    <div className="observability page-stack">
      <section className="observability-hero">
        <div>
          <span className="section-kicker">OPERATIONS COMMAND</span>
          <h2>运行观测</h2>
          <p>把失败、人工介入、恢复失败和成本信号聚合到一个排障入口。</p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            void loadOverview()
            void loadHumanSla()
            void loadCostUsage()
            void loadExecutionJobs()
          }}
        >
          <RefreshCw size={15} />刷新
        </button>
      </section>

      <section className="observability-metrics">
        <MetricCard label="总运行" value={overview.totals.totalRuns} icon={<Route size={17} />} />
        <MetricCard label="失败运行" value={overview.totals.failedRuns} icon={<AlertTriangle size={17} />} tone="danger" />
        <MetricCard label="人工介入" value={overview.totals.waitingForHuman} icon={<ClipboardList size={17} />} tone="warning" />
        <MetricCard label="恢复失败" value={overview.totals.resumeFailed} icon={<TimerReset size={17} />} tone="danger" />
        <MetricCard label="平均耗时" value={formatDuration(overview.totals.averageDurationMs)} icon={<Clock3 size={17} />} />
        <MetricCard label="模型成本" value={formatCost(overview.totals.totalCostUsd)} icon={<Coins size={17} />} />
      </section>

      <AlertOutboxPanel alerts={filteredAlerts} />

      <ExecutionQueuePanel
        jobs={executionJobs}
        isLoading={isExecutionJobsLoading}
        error={executionJobsError}
      />

      <HumanSlaPanel
        humanSla={humanSla}
        isLoading={isHumanSlaLoading}
        error={humanSlaError}
        reviewerId={reviewerId}
        groupId={groupId}
        onReviewerChange={setReviewerId}
        onGroupChange={setGroupId}
        reviewPath={workspacePath('reviews')}
      />

      <CostUsagePanel
        costUsage={costUsage}
        isLoading={isCostUsageLoading}
        error={costUsageError}
      />

      <div className="observability-layout">
        <section className="panel observability-run-list">
          <div className="panel-header">
            <div><span className="section-kicker">风险优先</span><h3>待排障运行</h3></div>
            <small>{filteredRuns.length} / {candidateRuns.length} 个实例</small>
          </div>

          <div className="observability-filter-bar">
            <label>
              <span>运行状态</span>
              <select
                aria-label="运行状态筛选"
                value={statusFilter}
                onChange={(event) => writeSearchParams({ status: event.target.value })}
              >
                {runStatusOptions.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <label>
              <span>工作流名称</span>
              <input
                aria-label="工作流名称筛选"
                value={workflowFilter}
                onChange={(event) => writeSearchParams({ workflow: event.target.value })}
                placeholder="搜索工作流"
              />
            </label>
            <label>
              <span>风险等级</span>
              <select
                aria-label="风险等级筛选"
                value={riskFilter}
                onChange={(event) => writeSearchParams({ risk: event.target.value })}
              >
                {riskOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>失败原因</span>
              <select
                aria-label="失败原因筛选"
                value={failureFilter}
                onChange={(event) => writeSearchParams({ failure: event.target.value })}
              >
                {failureOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button
              className="button ghost compact"
              type="button"
              onClick={() => writeSearchParams({
                status: '',
                workflow: '',
                risk: '',
                failure: '',
                runId: '',
              })}
            >
              清空筛选
            </button>
          </div>

          {filteredRuns.length === 0 && (
            <div className="observability-filter-empty">
              <strong>当前筛选无运行</strong>
              <span>换一个状态、工作流名称、风险等级或失败原因，或清空筛选查看全部运行。</span>
            </div>
          )}

          {filteredRisks.length > 0 && (
            <div className="observability-risk-strip">
              {filteredRisks.map((risk) => (
                <button
                  key={risk.runId}
                  className={`observability-run-card ${selectedRunId === risk.runId ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedRunId(risk.runId)
                    writeSearchParams({ runId: risk.runId })
                  }}
                >
                  <span className={`risk-dot ${risk.severity}`} />
                  <strong>{risk.title}</strong>
                  <small>
                    {riskMessage(risk, overview.recentRuns)}
                    {' / '}
                    {overview.recentRuns.find((run) => run.id === risk.runId)?.failureCategoryLabel ?? '未分类'}
                    {' / '}
                    {risk.nextAction}
                  </small>
                  <StatusBadge status={risk.severity === 'critical' ? '高' : '中'} />
                </button>
              ))}
            </div>
          )}

          <div className="observability-recent-list">
            <h4>最近运行</h4>
            {filteredRuns.map((run) => (
              <button
                key={run.id}
                className={`observability-run-row ${selectedRunId === run.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedRunId(run.id)
                  writeSearchParams({ runId: run.id })
                }}
              >
                <span>
                  <strong>{run.workflowName}</strong>
                  <small>{runTitle(run)} / {run.failureCategoryLabel}</small>
                </span>
                <StatusBadge status={run.status} />
                <em>{formatOptionalDuration(run.durationMs)}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="panel observability-detail">
          {isDetailLoading && <div className="table-state">正在加载运行详情...</div>}
          {detailError && <div className="table-state error" role="alert">{detailError}</div>}
          {!isDetailLoading && !detailError && detail && <RunTroubleshooting detail={detail} />}
        </section>
      </div>
    </div>
  )
}

function ExecutionQueuePanel({
  jobs,
  isLoading,
  error,
}: {
  jobs: ExecutionJob[]
  isLoading: boolean
  error: string
}) {
  const counts = jobs.reduce<Record<string, number>>((nextCounts, job) => {
    nextCounts[job.status] = (nextCounts[job.status] ?? 0) + 1
    return nextCounts
  }, {})
  const visibleJobs = jobs.slice(0, 6)

  return (
    <section className="panel execution-queue-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">EXECUTION QUEUE</span>
          <h3>执行队列运营</h3>
        </div>
        <small>{jobs.length} 条任务</small>
      </div>

      {isLoading && <div className="table-state">正在加载执行队列...</div>}
      {error && <div className="table-state error" role="alert">{error}</div>}
      {!isLoading && !error && (
        <>
          <div className="execution-queue-metrics">
            <MetricCard label="排队中" value={counts.queued ?? 0} icon={<ListChecks size={17} />} />
            <MetricCard label="运行中" value={counts.running ?? 0} icon={<Route size={17} />} />
            <MetricCard label="已完成" value={counts.succeeded ?? 0} icon={<ClipboardList size={17} />} />
            <MetricCard label="死信" value={counts.dead_letter ?? 0} icon={<AlertTriangle size={17} />} tone="danger" />
          </div>
          {visibleJobs.length === 0
            ? <p className="muted-copy">暂无执行队列任务。</p>
            : (
              <div className="execution-queue-list">
                {visibleJobs.map((job) => (
                  <article className={`execution-queue-item ${job.status}`} key={job.id}>
                    <div>
                      <strong>{executionJobStatusLabel(job.status)} · {job.jobType}</strong>
                      <span>Run {job.runId.slice(0, 8)} / Workflow {job.workflowId?.slice(0, 8) ?? '无'}</span>
                      {job.error && <p>{job.error}</p>}
                    </div>
                    <aside>
                      <StatusBadge status={executionJobStatusLabel(job.status)} />
                      <span>{job.attempts}/{job.maxAttempts} 次</span>
                      <small>{job.lockedBy || '未锁定'} · {formatTime(job.lockedUntil)}</small>
                    </aside>
                  </article>
                ))}
              </div>
            )}
        </>
      )}
    </section>
  )
}

function CostUsagePanel({
  costUsage,
  isLoading,
  error,
}: {
  costUsage: CostUsageOverview | null
  isLoading: boolean
  error: string
}) {
  return (
    <section className="panel cost-usage-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">MODEL USAGE</span>
          <h3>成本与模型调用</h3>
        </div>
        {costUsage && !costUsage.costConfigured && (
          <span className="cost-config-warning">成本单价未配置</span>
        )}
      </div>

      {isLoading && <div className="table-state">正在加载成本与模型调用数据...</div>}
      {error && <div className="table-state error" role="alert">{error}</div>}
      {!isLoading && !error && costUsage && (
        <>
          <div className="cost-usage-summary">
            <MetricCard label="运行次数" value={costUsage.totals.runs} icon={<Route size={17} />} />
            <MetricCard label="总 Token" value={costUsage.totals.totalTokens} icon={<BarChart3 size={17} />} />
            <MetricCard label="Prompt Token" value={costUsage.totals.totalPromptTokens} icon={<BarChart3 size={17} />} />
            <MetricCard label="Completion Token" value={costUsage.totals.totalCompletionTokens} icon={<BarChart3 size={17} />} />
            <MetricCard label="累计成本" value={formatCost(costUsage.totals.totalCostUsd)} icon={<Coins size={17} />} />
          </div>

          <div className="cost-usage-columns">
            <CostUsageTable title="按工作流" rows={costUsage.byWorkflow} />
            <CostUsageTable title="按模型" rows={costUsage.byModel} />
          </div>
        </>
      )}
    </section>
  )
}

function AlertOutboxPanel({ alerts }: { alerts: ObservabilityAlert[] }) {
  return (
    <section className="panel observability-alert-outbox">
      <div className="panel-header">
        <div>
          <span className="section-kicker">ALERT OUTBOX</span>
          <h3>告警 Outbox</h3>
        </div>
        <small>{alerts.length} 条待处理</small>
      </div>

      {alerts.length === 0
        ? <p className="muted-copy">暂无待处理告警。</p>
        : (
          <div className="observability-alert-list">
            {alerts.map((alert) => (
              <article className={`observability-alert-item ${alert.severity}`} key={alert.id}>
                <span className={`risk-dot ${alert.severity}`} />
                <div>
                  <strong>{alert.title}</strong>
                  <p>{alert.message}</p>
                  <em>{alert.eventType}</em>
                </div>
                <aside>
                  <StatusBadge status={alert.severity === 'critical' ? '高' : '中'} />
                  <span>{alert.channel} / {alert.status}</span>
                  <small>{alert.nextAction}</small>
                </aside>
              </article>
            ))}
          </div>
        )}
    </section>
  )
}

function CostUsageTable({
  title,
  rows,
}: {
  title: string
  rows: CostUsageGroup[]
}) {
  return (
    <div className="cost-usage-table">
      <h4>{title}</h4>
      {rows.length === 0
        ? <p className="muted-copy">暂无调用记录。</p>
        : rows.map((row) => (
          <article key={row.name}>
            <div>
              <strong>{row.name}</strong>
              <span>{row.runs} 次运行 / {row.totalTokens} Token / 均分 {row.averageScore ?? '待评估'}</span>
            </div>
            <em>{formatCost(row.costUsd)}</em>
          </article>
        ))}
    </div>
  )
}

function HumanSlaPanel({
  humanSla,
  isLoading,
  error,
  reviewerId,
  groupId,
  onReviewerChange,
  onGroupChange,
  reviewPath,
}: {
  humanSla: HumanSlaOverview | null
  isLoading: boolean
  error: string
  reviewerId: string
  groupId: string
  onReviewerChange: (value: string) => void
  onGroupChange: (value: string) => void
  reviewPath: string
}) {
  return (
    <section className="panel human-sla-panel">
      <div className="panel-header human-sla-header">
        <div>
          <span className="section-kicker">HUMAN SLA</span>
          <h3>人工 SLA 运营</h3>
        </div>
        <div className="human-sla-filters">
          <label>
            <span>Reviewer</span>
            <select
              aria-label="按 Reviewer 过滤"
              value={reviewerId}
              onChange={(event) => onReviewerChange(event.target.value)}
            >
              <option value="">全部 Reviewer</option>
              {humanSla?.reviewers.map((reviewer) => (
                <option key={reviewer.id} value={reviewer.id}>{reviewer.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>审核组</span>
            <select
              aria-label="按审核组过滤"
              value={groupId}
              onChange={(event) => onGroupChange(event.target.value)}
            >
              <option value="">全部审核组</option>
              {humanSla?.groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {isLoading && <div className="table-state">正在加载人工 SLA 数据...</div>}
      {error && <div className="table-state error" role="alert">{error}</div>}
      {!isLoading && !error && humanSla && (
        <>
          <div className="human-sla-metrics">
            <MetricCard label="活跃任务" value={humanSla.totals.activeTasks} icon={<ClipboardList size={17} />} />
            <MetricCard label="待认领" value={humanSla.totals.unclaimed} icon={<UserRound size={17} />} tone="warning" />
            <MetricCard label="审核中" value={humanSla.totals.inReview} icon={<Clock3 size={17} />} />
            <MetricCard label="即将到期" value={humanSla.totals.dueSoon} icon={<TimerReset size={17} />} tone="warning" />
            <MetricCard label="已逾期" value={humanSla.totals.overdue} icon={<AlertTriangle size={17} />} tone="danger" />
            <MetricCard label="已升级" value={humanSla.totals.escalated} icon={<ShieldAlert size={17} />} tone="danger" />
            <MetricCard label="恢复失败" value={humanSla.totals.resumeFailed} icon={<RefreshCw size={17} />} tone="danger" />
          </div>

          <div className="human-sla-risk-list">
            {humanSla.risks.length === 0
              ? <p className="muted-copy">暂无即将到期、已逾期、已升级或恢复失败的人工任务。</p>
              : humanSla.risks.map((risk) => (
                <HumanSlaRiskRow key={risk.taskId} risk={risk} reviewPath={reviewPath} />
              ))}
          </div>
        </>
      )}
    </section>
  )
}

function HumanSlaRiskRow({
  risk,
  reviewPath,
}: {
  risk: HumanSlaRisk
  reviewPath: string
}) {
  return (
    <article className={`human-sla-risk ${risk.severity}`}>
      <div>
        <strong>{risk.title}</strong>
        <span>
          {displayStatus(risk.status)} / SLA：{displayStatus(risk.slaStatus)} / 截止 {formatTime(risk.dueAt)}
        </span>
      </div>
      <StatusBadge status={risk.severity === 'critical' ? '高' : '中'} />
      <Link className="button secondary compact" to={`${reviewPath}?taskId=${risk.taskId}`}>
        {risk.nextAction}
      </Link>
    </article>
  )
}

function MetricCard({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string
  value: number | string
  icon: ReactNode
  tone?: 'neutral' | 'warning' | 'danger'
}) {
  return (
    <article className={`observability-metric ${tone}`}>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function RunTroubleshooting({ detail }: { detail: ObservabilityRunDetail }) {
  const resultText = detail.output || detail.error || '本次运行暂无产出或错误信息。'

  return (
    <>
      <header className="observability-detail-header">
        <div>
          <span className="mono">{detail.id}</span>
          <h3>{detail.workflowName}</h3>
        <p>{runTitle(detail)} / {formatTime(detail.startedAt)} 启动</p>
          <div className="observability-trace-chip">
            <span>Trace ID</span>
            <strong>{detail.traceId}</strong>
          </div>
        </div>
        <StatusBadge status={detail.status} />
      </header>

      <div className="observability-next-action">
        <ShieldAlert size={18} />
        <div>
          <strong>{detail.failureCategoryLabel} · {detail.nextAction}</strong>
          <span>当前节点：{detail.currentNode || '未记录'} / 状态：{displayStatus(detail.status)}</span>
          <p>{detail.troubleshootingHint}</p>
        </div>
      </div>

      <div className="observability-detail-grid">
        <div><span>耗时</span><strong>{formatOptionalDuration(detail.durationMs)}</strong></div>
        <div><span>质量分</span><strong>{detail.score ?? '待评估'}</strong></div>
        <div><span>Token</span><strong>{detail.promptTokens + detail.completionTokens}</strong></div>
        <div><span>成本</span><strong>{formatCost(detail.costUsd)}</strong></div>
      </div>

      <section className="observability-result">
        <h4>运行输入与产出</h4>
        <div><span>输入</span><p>{detail.input || '无输入记录'}</p></div>
        <div><span>结果</span><p>{resultText}</p></div>
      </section>

      <ExecutionEventStream events={detail.executionEvents ?? []} />

      <section className="observability-section">
        <h4>节点执行链路</h4>
        {detail.nodes.length === 0
          ? <p className="muted-copy">暂无节点明细。</p>
          : detail.nodes.map((node) => (
            <article className="observability-node" key={node.id}>
              <div>
                <strong>{node.nodeName}</strong>
                <span>{node.nodeType} / 尝试 {node.attempts} 次 / {formatDuration(node.durationMs)}</span>
                <em>Span {node.spanId}</em>
                <em>父 Span {node.parentSpanId ?? 'root'}</em>
              </div>
              <StatusBadge status={node.status} />
              <p>{node.output || node.error || node.input}</p>
            </article>
          ))}
      </section>

      <section className="observability-section">
        <h4>人工审核任务</h4>
        {detail.humanTasks.length === 0
          ? <p className="muted-copy">当前运行没有关联 Human Task。</p>
          : detail.humanTasks.map((task) => (
            <article className="observability-human-task" key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <span>SLA：{displayStatus(task.slaStatus)} / 截止 {formatTime(task.dueAt)}</span>
              </div>
              <StatusBadge status={task.status} />
            </article>
          ))}
      </section>

      <section className="observability-section">
        <h4>审计事件</h4>
        {detail.auditEvents.length === 0
          ? <p className="muted-copy">暂无审计事件。</p>
          : detail.auditEvents.map((event) => (
            <article className="observability-audit" key={event.id}>
              <span>{formatTime(event.createdAt)}</span>
              <strong>{event.eventType ?? '事件'}</strong>
              <em>审计 Span {event.spanId ?? '未关联'}</em>
              <p>{event.reason || event.outcome || '未记录原因'}</p>
            </article>
          ))}
      </section>
    </>
  )
}

function ExecutionEventStream({ events }: { events: ObservabilityExecutionEvent[] }) {
  return (
    <section className="observability-section execution-event-stream" aria-label="执行事件流">
      <h4>执行事件流</h4>
      {events.length === 0
        ? <p className="muted-copy">暂无统一执行事件。</p>
        : (
          <div className="execution-event-list">
            {events.map((event) => (
              <article className={`execution-event ${event.sourceType}`} key={event.id}>
                <time>{formatTime(event.occurredAt)}</time>
                <div>
                  <strong>{event.title}</strong>
                  <span>{event.sourceType} · {event.type}</span>
                  <p>{event.summary}</p>
                  <em>Trace {event.traceId}</em>
                  <em>Span {event.spanId ?? 'root'}</em>
                </div>
                {event.status && <StatusBadge status={event.status} />}
              </article>
            ))}
          </div>
        )}
    </section>
  )
}
