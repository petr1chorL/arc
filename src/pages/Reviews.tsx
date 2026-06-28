import {
  ArrowRightLeft,
  Check,
  CheckCheck,
  Clock3,
  FileDiff,
  FilePenLine,
  History,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/authContext'
import { useWorkspace } from '../auth/workspaceContextState'
import {
  claimHumanTask,
  confirmFeedbackCandidate,
  decideHumanTask,
  getHumanTask,
  listFeedbackCandidates,
  listHumanTasks,
  listReviewers,
  listReviewGroups,
  retryHumanTaskResume,
  transferHumanTask,
} from '../api/humanTasks'
import { listRuns } from '../api/execution'
import { StatusBadge } from '../components/StatusBadge'
import { displayStatus } from '../domain/statusText'
import type {
  ExecutionRun,
  FeedbackCandidate,
  HumanTask,
  HumanTaskDecision,
  HumanTaskDetail,
  Reviewer,
  ReviewGroup,
} from '../types'

type MobilePane = 'queue' | 'review' | 'context'

const terminalStatuses = new Set(['已通过', '修改后通过', '已驳回', '已退回'])
const reviewerQualificationsUpdatedEvent = 'reviewer-qualifications-updated'
const reviewStatusOptions = ['全部', '待认领', '审核中', '恢复失败', '已通过', '修改后通过', '已驳回', '已退回']

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function Reviews() {
  const { user } = useAuth()
  const { workspace, workspacePath } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTaskId = searchParams.get('taskId') ?? ''
  const requestedTaskStatus = searchParams.get('taskStatus') ?? '全部'
  const requestedSlaStatus = searchParams.get('slaStatus') ?? '全部'
  const reviewSource = searchParams.get('source') ?? ''
  const [tasks, setTasks] = useState<HumanTask[]>([])
  const [detail, setDetail] = useState<HumanTaskDetail | null>(null)
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [groups, setGroups] = useState<ReviewGroup[]>([])
  const [candidates, setCandidates] = useState<FeedbackCandidate[]>([])
  const [runs, setRuns] = useState<ExecutionRun[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [statusFilter, setStatusFilter] = useState(() => (
    reviewStatusOptions.includes(requestedTaskStatus) ? requestedTaskStatus : '全部'
  ))
  const [slaFilter, setSlaFilter] = useState(() => (
    ['全部', '正常', '即将到期', '已逾期', '已升级'].includes(requestedSlaStatus) ? requestedSlaStatus : '全部'
  ))
  const [mobilePane, setMobilePane] = useState<MobilePane>('queue')
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [reason, setReason] = useState('')
  const [transferReviewerId, setTransferReviewerId] = useState('')
  const [transferReason, setTransferReason] = useState('')
  const [expertReason, setExpertReason] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const loadWorkspace = useCallback(async () => {
    setError('')
    try {
      const [nextTasks, nextReviewers, nextGroups, nextCandidates, nextRuns] = await Promise.all([
        listHumanTasks(workspace.id),
        listReviewers(workspace.id),
        listReviewGroups(workspace.id),
        listFeedbackCandidates(workspace.id),
        listRuns(workspace.id).catch(() => []),
      ])
      setTasks(nextTasks)
      setReviewers(nextReviewers)
      setGroups(nextGroups)
      setCandidates(nextCandidates)
      setRuns(nextRuns)
      setSelectedId((current) => (
        requestedTaskId && nextTasks.some((task) => task.id === requestedTaskId)
          ? requestedTaskId
          : nextTasks.some((task) => task.id === current)
          ? current
          : nextTasks[0]?.id ?? ''
      ))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '人工任务加载失败')
    }
  }, [requestedTaskId, workspace.id])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (selectedId) next.set('taskId', selectedId)
      else next.delete('taskId')
      if (statusFilter !== '全部') next.set('taskStatus', statusFilter)
      else next.delete('taskStatus')
      if (slaFilter !== '全部') next.set('slaStatus', slaFilter)
      else next.delete('slaStatus')
      return next.toString() === current.toString() ? current : next
    }, { replace: true })
  }, [selectedId, setSearchParams, slaFilter, statusFilter])

  useEffect(() => {
    function refreshReviewers() {
      void loadWorkspace()
    }

    function refreshReviewersFromStorage(event: StorageEvent) {
      if (event.key === reviewerQualificationsUpdatedEvent) {
        void loadWorkspace()
      }
    }

    window.addEventListener(reviewerQualificationsUpdatedEvent, refreshReviewers)
    window.addEventListener('storage', refreshReviewersFromStorage)
    return () => {
      window.removeEventListener(reviewerQualificationsUpdatedEvent, refreshReviewers)
      window.removeEventListener('storage', refreshReviewersFromStorage)
    }
  }, [loadWorkspace])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    setError('')
    void getHumanTask(workspace.id, selectedId)
      .then((nextDetail) => {
        setDetail(nextDetail)
        setEditedContent(nextDetail.artifact.content)
        setIsEditing(false)
        setReason('')
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : '人工任务详情加载失败')
      })
  }, [selectedId, workspace.id])

  const filteredTasks = useMemo(() => tasks.filter((task) => (
    (statusFilter === '全部' || task.status === statusFilter)
    && (slaFilter === '全部' || displayStatus(task.slaStatus) === slaFilter)
  )), [slaFilter, statusFilter, tasks])

  const currentReviewer = reviewers.find((reviewer) => (
    reviewer.userId === user?.id && reviewer.isActive
  ))
  const hasReviewerQualification = Boolean(currentReviewer)
  const activeTasks = tasks.filter((task) => !terminalStatuses.has(task.status))
  const slaRiskTasks = activeTasks.filter((task) => displayStatus(task.slaStatus) !== '正常')
  const myTaskCount = currentReviewer
    ? activeTasks.filter((task) => (
      task.assigneeReviewerId === currentReviewer.id || task.participantSnapshot.includes(currentReviewer.id)
    )).length
    : 0
  const pendingFeedbackCount = candidates.filter((candidate) => candidate.status === '待确认').length
  const latestRun = runs[0]
  const latestRunStatus = latestRun ? displayStatus(latestRun.status) : '暂无运行'
  const selectedCandidate = candidates.find((candidate) => candidate.humanTaskId === selectedId)
  const selectedGroup = groups.find((group) => group.id === detail?.assigneeGroupId)
  const isTerminal = detail ? terminalStatuses.has(detail.status) : true
  const canHandleCurrentTask = detail ? canCurrentReviewerHandleTask() : false
  const actionDisabled = isBusy || !canHandleCurrentTask
  const currentTaskPermission = detail ? getCurrentTaskPermission() : null
  const reviewSourceLabel = reviewSource === 'sla'
    ? '来自 SLA 风险入口'
    : reviewSource === 'observability'
    ? '来自运行观测入口'
    : reviewSource
    ? `来自 ${reviewSource}`
    : '来自分享链接'
  const hasUrlContext = Boolean(reviewSource || statusFilter !== '全部' || slaFilter !== '全部')

  function getReviewNextStep() {
    if (!hasReviewerQualification) {
      return '先在成员与权限中绑定 Reviewer 资格，再运行包含人工审核节点的工作流。'
    }
    if (!latestRun) {
      return '先发布并运行一个包含人工审核节点的工作流。'
    }
    if (latestRunStatus === '需介入') {
      return '最近运行已经进入人工审核，刷新队列或检查当前账号是否具备该任务参与资格。'
    }
    if (latestRunStatus === '已完成') {
      return '最近运行已完成但没有停在人工审核；请检查工作流是否包含并连通 Human 节点。'
    }
    if (latestRunStatus === '失败') {
      return '最近运行失败；先到运行中心查看失败节点，再重新运行。'
    }
    return '继续观察最近运行状态，或重新运行包含人工审核节点的工作流。'
  }

  function canCurrentReviewerHandleTask() {
    return Boolean(
      detail
      && currentReviewer
      && !isTerminal
      && (!detail.assigneeReviewerId || detail.assigneeReviewerId === currentReviewer.id)
      && detail.participantSnapshot.includes(currentReviewer.id),
    )
  }

  function getCurrentTaskPermission() {
    if (!detail) return null
    if (!hasReviewerQualification) {
      return {
        tone: 'blocked',
        status: '不能处理',
        reason: '当前账号未绑定 Reviewer 资格，所以不能认领任务或提交审核决定。',
        nextStep: '先到成员与权限页绑定当前账号 Reviewer 资格。',
      }
    }
    if (isTerminal) {
      return {
        tone: 'neutral',
        status: '只能查看',
        reason: '当前任务已进入终态，不能再次提交审核决定。',
        nextStep: '查看审计时间线或切换其他待处理任务。',
      }
    }
    if (detail.assigneeReviewerId && detail.assigneeReviewerId !== currentReviewer?.id) {
      return {
        tone: 'blocked',
        status: '不能处理',
        reason: '当前任务已分配给其他审核人。',
        nextStep: '请等待对方处理，或由有权限的人先完成任务转交。',
      }
    }
    if (currentReviewer && !detail.participantSnapshot.includes(currentReviewer.id)) {
      return {
        tone: 'blocked',
        status: '不能处理',
        reason: '当前 Reviewer 不在该任务参与范围内，不能认领或提交决定。',
        nextStep: '把当前账号加入该 Human 节点的审核人或审核组后，再回到这里处理。',
      }
    }
    return {
      tone: 'ready',
      status: '可以处理',
      reason: '当前账号在任务参与范围内，可以认领或提交审核决定。',
      nextStep: '填写审核原因后，选择通过、驳回、退回重跑或修改后通过。',
    }
  }

  function updateTask(nextTask: HumanTask) {
    setTasks((current) => current.map((task) => (
      task.id === nextTask.id ? { ...task, ...nextTask } : task
    )))
  }

  function notifyHumanTasksUpdated() {
    window.dispatchEvent(new Event('human-tasks-updated'))
  }

  async function claim() {
    if (!detail || !currentReviewer) return
    setIsBusy(true)
    setError('')
    try {
      const updated = await claimHumanTask(workspace.id, detail.id)
      updateTask(updated)
      setDetail((current) => current ? { ...current, ...updated } : current)
      notifyHumanTasksUpdated()
      setMessage('任务已认领')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '任务认领失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function transfer() {
    if (!detail || !currentReviewer) return
    if (!transferReviewerId || !transferReason.trim()) {
      setError('请选择转交审核人并填写转交原因')
      return
    }
    setIsBusy(true)
    setError('')
    try {
      const updated = await transferHumanTask(workspace.id, detail.id, {
        targetReviewerId: transferReviewerId,
        reason: transferReason.trim(),
      })
      updateTask(updated)
      setDetail((current) => current ? { ...current, ...updated } : current)
      notifyHumanTasksUpdated()
      setTransferReason('')
      setMessage('任务已转交')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '任务转交失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function decide(decision: HumanTaskDecision) {
    if (!detail || !currentReviewer) return
    if (!reason.trim()) {
      setError('请填写审核原因')
      return
    }
    if (
      decision === 'modify_and_approve'
      && (!editedContent.trim() || editedContent.trim() === detail.artifact.content.trim())
    ) {
      setError('修改后通过需要提交不同的产出物内容')
      return
    }
    setIsBusy(true)
    setError('')
    try {
      const updated = await decideHumanTask(workspace.id, detail.id, {
        decision,
        reason: reason.trim(),
        artifactVersionId: detail.artifact.id,
        idempotencyKey: `${detail.id}:${currentReviewer.id}:${decision}:${Date.now()}`,
        ...(decision === 'modify_and_approve'
          ? { modifiedContent: editedContent.trim(), tags: ['人工修订'] }
          : {}),
      })
      setDetail(updated)
      setEditedContent(updated.artifact.content)
      updateTask(updated)
      notifyHumanTasksUpdated()
      setMessage('审核决定已提交')
      setReason('')
      setIsEditing(false)
      setCandidates(await listFeedbackCandidates(workspace.id))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '审核决定提交失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function retryResume() {
    if (!detail) return
    setIsBusy(true)
    setError('')
    try {
      const updated = await retryHumanTaskResume(workspace.id, detail.id)
      setDetail(updated)
      updateTask(updated)
      notifyHumanTasksUpdated()
      setMessage('工作流恢复已重试')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '恢复重试失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function confirmGolden() {
    if (!selectedCandidate || !currentReviewer?.isExpert) return
    if (!expertReason.trim()) {
      setError('请填写专家确认理由')
      return
    }
    setIsBusy(true)
    setError('')
    try {
      await confirmFeedbackCandidate(workspace.id, selectedCandidate.id, {
        reason: expertReason.trim(),
        idempotencyKey: `${selectedCandidate.id}:${currentReviewer.id}:golden`,
      })
      setCandidates((current) => current.map((candidate) => (
        candidate.id === selectedCandidate.id
          ? { ...candidate, status: '已确认', confirmedAt: new Date().toISOString() }
          : candidate
      )))
      setExpertReason('')
      setMessage('黄金样本已创建')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '黄金样本确认失败')
    } finally {
      setIsBusy(false)
    }
  }

  if (error && tasks.length === 0) {
    return (
      <div className="panel table-state error" role="alert">
        {error}
        <button className="button secondary" onClick={() => void loadWorkspace()}>
          <RefreshCw size={15} />重试
        </button>
      </div>
    )
  }

  if (!detail && tasks.length === 0) {
    return (
      <section className="review-empty-state panel">
        <div>
          <span className="section-kicker">HUMAN IN THE LOOP</span>
          <h2>暂无人工任务</h2>
          <p>工作流运行到人工审核节点后，任务会自动进入这里。</p>
        </div>
        <ol className="review-acceptance-steps" aria-label="人工审核任务验收路径">
          <li>在工作流编排中加入人工审核节点并发布版本</li>
          <li>运行已发布工作流，等待状态进入需介入</li>
          <li>回到人工审核页认领任务并提交决定</li>
        </ol>
        <section className="review-diagnostic-panel" aria-label="人工审核验收诊断">
          <div className="context-title"><ShieldCheck size={15} /><h3>验收诊断</h3></div>
          <div className="review-diagnostic-grid">
            <div>
              <span>当前账号</span>
              <strong>{user?.displayName ?? '未登录'}</strong>
            </div>
            <div>
              <span>Reviewer 资格</span>
              <strong>{hasReviewerQualification ? currentReviewer?.role : '未获得'}</strong>
            </div>
            <div>
              <span>人工任务数量</span>
              <strong>{tasks.length}</strong>
            </div>
            <div>
              <span>最近运行状态</span>
              <strong>{latestRunStatus}</strong>
            </div>
            <div className="wide">
              <span>下一步建议</span>
              <strong>{getReviewNextStep()}</strong>
            </div>
          </div>
        </section>
        <div className="review-empty-grid">
          <div>
            <span>当前 Reviewer 资格</span>
            <strong>{hasReviewerQualification ? currentReviewer?.role : '未获得'}</strong>
            <small>{hasReviewerQualification ? '可以认领或处理参与范围内的任务' : '需要在成员与权限中绑定审核资格'}</small>
          </div>
          <div>
            <span>审核组</span>
            <strong>{groups.length}</strong>
            <small>任务会按 Human 节点配置分配到审核人或审核组</small>
          </div>
          <div>
            <span>待确认反馈</span>
            <strong>{pendingFeedbackCount}</strong>
            <small>修改后通过才会产生反馈候选</small>
          </div>
        </div>
        <div className="review-empty-actions">
          <a className="button primary" href={workspacePath('workflows')}>去工作流编排</a>
          <a className="button secondary" href={workspacePath('settings/members')}>查看成员与权限</a>
          <button className="button ghost" onClick={() => void loadWorkspace()}>
            <RefreshCw size={15} />刷新队列
          </button>
        </div>
      </section>
    )
  }

  return (
    <div className="review-workbench-shell">
      {message && <div className="toast"><Check size={16} />{message}</div>}
      <section className="review-summary-strip" aria-label="人工审核概览">
        <div>
          <span>待处理任务</span>
          <strong>{activeTasks.length}</strong>
          <small>终态任务不计入待处理</small>
        </div>
        <div>
          <span>我的参与范围</span>
          <strong>{myTaskCount}</strong>
          <small>{hasReviewerQualification ? currentReviewer?.role : '需要在成员页配置资格'}</small>
        </div>
        <div>
          <span>SLA 风险</span>
          <strong>{slaRiskTasks.length}</strong>
          <small>即将到期、逾期或已升级</small>
        </div>
        <div>
          <span>待确认反馈</span>
          <strong>{pendingFeedbackCount}</strong>
          <small>专家可沉淀为 Golden Sample</small>
        </div>
      </section>

      {hasUrlContext && (
        <section className="review-url-context" aria-label="当前审核上下文">
          <div>
            <span>当前审核上下文</span>
            <strong>{reviewSourceLabel}</strong>
            <p>该视图来自 URL 参数，可复制给协作者或刷新后继续恢复同一审核队列上下文。</p>
          </div>
          <div className="review-url-context-tags">
            {selectedId && <strong>任务 {selectedId}</strong>}
            <strong>状态 {statusFilter}</strong>
            <strong>SLA {slaFilter}</strong>
          </div>
          <button
            className="button ghost"
            type="button"
            onClick={() => {
              setStatusFilter('全部')
              setSlaFilter('全部')
            }}
          >
            清空上下文筛选
          </button>
        </section>
      )}

      <div className="review-workbench">
      <nav className="review-mobile-tabs" aria-label="审核工作台视图">
        {([
          ['queue', '队列'],
          ['review', '审核'],
          ['context', '上下文'],
        ] as Array<[MobilePane, string]>).map(([pane, label]) => (
          <button
            aria-pressed={mobilePane === pane}
            className={mobilePane === pane ? 'active' : ''}
            key={pane}
            onClick={() => setMobilePane(pane)}
          >
            {label}
          </button>
        ))}
      </nav>

      <aside className={`review-pane review-task-pane ${mobilePane === 'queue' ? 'mobile-active' : ''}`}>
        <header className="review-pane-header">
          <div><span className="section-kicker">HUMAN TASKS</span><h2>审核队列</h2></div>
          <span className="queue-count">{filteredTasks.length}</span>
        </header>
        <div className="review-filters">
          <label>
            <span>状态</span>
            <select aria-label="任务状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {reviewStatusOptions.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <label>
            <span>SLA</span>
            <select aria-label="SLA 筛选" value={slaFilter} onChange={(event) => setSlaFilter(event.target.value)}>
              <option>全部</option>
              <option>正常</option>
              <option>即将到期</option>
              <option>已逾期</option>
              <option>已升级</option>
            </select>
          </label>
        </div>
        <div className="review-task-list">
          {filteredTasks.length === 0 && (
            <div className="review-filter-empty">
              <strong>当前筛选无任务</strong>
              <span>换一个状态或 SLA 条件，或清空筛选查看全部审核任务。</span>
              <button
                className="button ghost"
                onClick={() => {
                  setStatusFilter('全部')
                  setSlaFilter('全部')
                }}
              >
                清空筛选
              </button>
            </div>
          )}
          {filteredTasks.map((task) => {
            const taskSlaStatus = displayStatus(task.slaStatus)
            return (
              <button
                className={`review-task-row ${task.id === selectedId ? 'selected' : ''}`}
                key={task.id}
                onClick={() => {
                  setSelectedId(task.id)
                  setMobilePane('review')
                }}
              >
                <div><StatusBadge status={task.status} /><span className={`sla-dot ${taskSlaStatus}`}>{taskSlaStatus}</span></div>
                <strong>{task.title}</strong>
                <span>{task.id}</span>
                <small><Clock3 size={13} />{formatTime(task.dueAt)}</small>
              </button>
            )
          })}
        </div>
      </aside>

      <main className={`review-pane review-editor-pane ${mobilePane === 'review' ? 'mobile-active' : ''}`}>
        {detail && (
          <>
            <header className="review-pane-header review-editor-header">
              <div>
                <span className="mono">{detail.id}</span>
                <h2>审核产出物</h2>
                <p>{detail.run.name} · {detail.run.currentNode}</p>
              </div>
              <StatusBadge status={detail.status} />
            </header>

            {error && <div className="inline-feedback error" role="alert">{error}</div>}

            <div className="review-operator-bar">
              <div className="reviewer-identity">
                <span>当前用户</span>
                <strong>{user?.displayName ?? '未登录'}</strong>
                <small>
                  {currentReviewer
                    ? `${currentReviewer.name} · ${currentReviewer.role}${currentReviewer.isExpert ? ' · 专家' : ''}`
                    : '未获得 Reviewer 资格'}
                </small>
              </div>
              {currentTaskPermission && (
                <div className={`review-permission-note ${currentTaskPermission.tone}`} aria-label="当前任务权限">
                  <span>当前任务权限</span>
                  <div>
                    <strong>{currentTaskPermission.status}</strong>
                    <p>{currentTaskPermission.reason}</p>
                    <small>{currentTaskPermission.nextStep}</small>
                  </div>
                </div>
              )}
              {!detail.assigneeReviewerId && !isTerminal && (
                <button
                  className="button secondary"
                  disabled={actionDisabled}
                  onClick={() => void claim()}
                  title={actionDisabled && currentTaskPermission
                    ? `${currentTaskPermission.status}：${currentTaskPermission.reason}`
                    : '认领任务'}
                >
                  <UserCheck size={15} />认领任务
                </button>
              )}
            </div>

            <section className="artifact-work-area">
              <div className="review-section-title">
                <div><FilePenLine size={16} /><h3>Artifact v{detail.artifact.version}</h3></div>
                <button className="button ghost" onClick={() => setIsEditing((current) => !current)}>
                  <FileDiff size={15} />{isEditing ? '查看原文' : '编辑产出物'}
                </button>
              </div>
              {isEditing ? (
                <>
                  <label className="review-editor-field">
                    <span>修订后的产出物</span>
                    <textarea
                      aria-label="修订后的产出物"
                      value={editedContent}
                      onChange={(event) => setEditedContent(event.target.value)}
                    />
                  </label>
                  <div className="diff-preview">
                    <span>变更预览</span>
                    <del>{detail.artifact.content}</del>
                    <ins>{editedContent || '等待输入修订内容'}</ins>
                  </div>
                </>
              ) : (
                <div className="artifact-document">{detail.artifact.content}</div>
              )}
            </section>

            <label className="review-reason">
              <span>审核原因</span>
              <textarea
                aria-label="审核原因"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="记录判断依据、风险或修改原因"
              />
            </label>

            <footer className="review-command-bar">
              {detail.status === '恢复失败' && (
                <button className="button secondary" disabled={isBusy} onClick={() => void retryResume()}>
                  <RefreshCw size={15} />重试恢复
                </button>
              )}
              <button className="button danger" disabled={actionDisabled} onClick={() => void decide('reject')}>
                <X size={15} />驳回
              </button>
              <button className="button secondary" disabled={actionDisabled} onClick={() => void decide('return_for_rerun')}>
                <RotateCcw size={15} />退回重跑
              </button>
              <button className="button secondary" disabled={actionDisabled} onClick={() => void decide('approve')}>
                <Check size={15} />通过
              </button>
              <button className="button primary" disabled={actionDisabled} onClick={() => void decide('modify_and_approve')}>
                <CheckCheck size={15} />修改后通过
              </button>
            </footer>
          </>
        )}
      </main>

      <aside className={`review-pane review-context-pane ${mobilePane === 'context' ? 'mobile-active' : ''}`}>
        {detail && (
          <>
            <header className="review-pane-header">
              <div><span className="section-kicker">DECISION CONTEXT</span><h2>运行上下文</h2></div>
              <ShieldCheck size={19} />
            </header>

            <section className="context-metrics">
              <div><span>质量得分</span><strong>{detail.run.score ?? '待评估'}</strong></div>
              <div><span>会签进度</span><strong>{detail.approvalProgress.received} / {detail.approvalProgress.required}</strong></div>
              <div><span>SLA</span><strong>{displayStatus(detail.slaStatus)}</strong></div>
              <div><span>审核组</span><strong>{selectedGroup?.name ?? '未分组'}</strong></div>
            </section>

            <section className="context-section">
              <div className="context-title"><ArrowRightLeft size={15} /><h3>任务转交</h3></div>
              <label>
                <span>转交审核人</span>
                <select aria-label="转交审核人" value={transferReviewerId} onChange={(event) => setTransferReviewerId(event.target.value)}>
                  <option value="">请选择</option>
                  {reviewers.filter((reviewer) => reviewer.id !== currentReviewer?.id).map((reviewer) => (
                    <option value={reviewer.id} key={reviewer.id}>{reviewer.name} · {reviewer.role}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>转交原因</span>
                <input aria-label="转交原因" value={transferReason} onChange={(event) => setTransferReason(event.target.value)} />
              </label>
              <button className="button secondary full" disabled={actionDisabled} onClick={() => void transfer()}>
                确认转交
              </button>
            </section>

            <section className="context-section">
              <div className="context-title"><History size={15} /><h3>审计时间线</h3></div>
              <div className="audit-timeline">
                {detail.auditEvents.map((event) => (
                  <div key={event.id}>
                    <i />
                    <strong>{event.eventType}</strong>
                    <span>{event.actorId} · {formatTime(event.createdAt)}</span>
                  </div>
                ))}
                {detail.notifications.map((item) => (
                  <div key={item.id}>
                    <i className="notification" />
                    <strong>{item.eventType}</strong>
                    <span>{item.status} · {formatTime(item.createdAt)}</span>
                  </div>
                ))}
              </div>
            </section>

            {selectedCandidate && (
              <section className="context-section feedback-candidate">
                <div className="context-title"><ShieldCheck size={15} /><h3>反馈候选</h3></div>
                <span className="candidate-status">{selectedCandidate.status}</span>
                <pre>{selectedCandidate.unifiedDiff}</pre>
                {currentReviewer?.isExpert && selectedCandidate.status === '待确认' ? (
                  <>
                    <label>
                      <span>专家确认理由</span>
                      <input aria-label="专家确认理由" value={expertReason} onChange={(event) => setExpertReason(event.target.value)} />
                    </label>
                    <button className="button primary full" disabled={isBusy} onClick={() => void confirmGolden()}>
                      确认黄金样本
                    </button>
                  </>
                ) : (
                  <small>{selectedCandidate.status === '已确认' ? '已进入 Golden Set' : '切换到专家审核人后可确认'}</small>
                )}
              </section>
            )}
          </>
        )}
      </aside>
      </div>
    </div>
  )
}
