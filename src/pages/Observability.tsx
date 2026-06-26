import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Clock3,
  Coins,
  RefreshCw,
  Route,
  ShieldAlert,
  TimerReset,
  UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  getHumanSlaOverview,
  getObservabilityOverview,
  getObservabilityRunDetail,
} from '../api/observability'
import { useWorkspace } from '../auth/workspaceContextState'
import { StatusBadge } from '../components/StatusBadge'
import { displayStatus } from '../domain/statusText'
import type {
  HumanSlaOverview,
  HumanSlaRisk,
  ObservabilityOverview,
  ObservabilityRisk,
  ObservabilityRunDetail,
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

function runTitle(run: ObservabilityRunSummary) {
  return run.workflowName
}

function riskMessage(risk: ObservabilityRisk, runs: ObservabilityRunSummary[]) {
  const relatedRun = runs.find((run) => run.id === risk.runId)
  const [status = '', node = '未知节点'] = risk.message.split(' · ')
  return `${displayStatus(relatedRun?.status ?? status)} · ${relatedRun?.currentNode || node}`
}

export function Observability() {
  const { workspace, workspacePath } = useWorkspace()
  const [overview, setOverview] = useState<ObservabilityOverview | null>(null)
  const [selectedRunId, setSelectedRunId] = useState('')
  const [detail, setDetail] = useState<ObservabilityRunDetail | null>(null)
  const [humanSla, setHumanSla] = useState<HumanSlaOverview | null>(null)
  const [reviewerId, setReviewerId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [isHumanSlaLoading, setIsHumanSlaLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [humanSlaError, setHumanSlaError] = useState('')

  const candidateRuns = useMemo(() => {
    if (!overview) return []
    const seen = new Set<string>()
    return overview.recentRuns.filter((run) => {
      if (seen.has(run.id)) return false
      seen.add(run.id)
      return true
    })
  }, [overview])

  const loadOverview = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const nextOverview = await getObservabilityOverview(workspace.id)
      setOverview(nextOverview)
      const firstRiskId = nextOverview.risks[0]?.runId
      const firstRun = nextOverview.recentRuns.find((run) => run.id === firstRiskId) ?? nextOverview.recentRuns[0]
      setSelectedRunId((current) => {
        const stillExists = [
          ...nextOverview.recentRuns.map((run) => run.id),
        ].includes(current)
        return stillExists ? current : firstRun?.id ?? ''
      })
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

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    void loadHumanSla()
  }, [loadHumanSla])

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

      <div className="observability-layout">
        <section className="panel observability-run-list">
          <div className="panel-header">
            <div><span className="section-kicker">风险优先</span><h3>待排障运行</h3></div>
            <small>{candidateRuns.length} 个实例</small>
          </div>

          {overview.risks.length > 0 && (
            <div className="observability-risk-strip">
              {overview.risks.map((risk) => (
                <button
                  key={risk.runId}
                  className={`observability-run-card ${selectedRunId === risk.runId ? 'selected' : ''}`}
                  onClick={() => setSelectedRunId(risk.runId)}
                >
                  <span className={`risk-dot ${risk.severity}`} />
                  <strong>{risk.title}</strong>
                  <small>{riskMessage(risk, overview.recentRuns)} / {risk.nextAction}</small>
                  <StatusBadge status={risk.severity === 'critical' ? '高' : '中'} />
                </button>
              ))}
            </div>
          )}

          <div className="observability-recent-list">
            <h4>最近运行</h4>
            {overview.recentRuns.map((run) => (
              <button
                key={run.id}
                className={`observability-run-row ${selectedRunId === run.id ? 'selected' : ''}`}
                onClick={() => setSelectedRunId(run.id)}
              >
                <span>
                  <strong>{run.workflowName}</strong>
                  <small>{runTitle(run)}</small>
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
        </div>
        <StatusBadge status={detail.status} />
      </header>

      <div className="observability-next-action">
        <ShieldAlert size={18} />
        <div>
          <strong>{detail.nextAction}</strong>
          <span>当前节点：{detail.currentNode || '未记录'} / 状态：{displayStatus(detail.status)}</span>
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

      <section className="observability-section">
        <h4>节点执行链路</h4>
        {detail.nodes.length === 0
          ? <p className="muted-copy">暂无节点明细。</p>
          : detail.nodes.map((node) => (
            <article className="observability-node" key={node.id}>
              <div>
                <strong>{node.nodeName}</strong>
                <span>{node.nodeType} / 尝试 {node.attempts} 次 / {formatDuration(node.durationMs)}</span>
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
              <p>{event.reason || event.outcome || '未记录原因'}</p>
            </article>
          ))}
      </section>
    </>
  )
}
