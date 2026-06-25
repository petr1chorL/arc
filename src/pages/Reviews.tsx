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
import { StatusBadge } from '../components/StatusBadge'
import type {
  FeedbackCandidate,
  HumanTask,
  HumanTaskDecision,
  HumanTaskDetail,
  Reviewer,
  ReviewGroup,
} from '../types'

type MobilePane = 'queue' | 'review' | 'context'

const terminalStatuses = new Set(['已通过', '修改后通过', '已驳回', '已退回'])

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function Reviews() {
  const [tasks, setTasks] = useState<HumanTask[]>([])
  const [detail, setDetail] = useState<HumanTaskDetail | null>(null)
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [groups, setGroups] = useState<ReviewGroup[]>([])
  const [candidates, setCandidates] = useState<FeedbackCandidate[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [operatorId, setOperatorId] = useState('')
  const [statusFilter, setStatusFilter] = useState('全部')
  const [slaFilter, setSlaFilter] = useState('全部')
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
      const [nextTasks, nextReviewers, nextGroups, nextCandidates] = await Promise.all([
        listHumanTasks(),
        listReviewers(),
        listReviewGroups(),
        listFeedbackCandidates(),
      ])
      setTasks(nextTasks)
      setReviewers(nextReviewers)
      setGroups(nextGroups)
      setCandidates(nextCandidates)
      setOperatorId((current) => (
        nextReviewers.some((reviewer) => reviewer.id === current)
          ? current
          : nextReviewers[0]?.id ?? ''
      ))
      setSelectedId((current) => (
        nextTasks.some((task) => task.id === current)
          ? current
          : nextTasks[0]?.id ?? ''
      ))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '人工任务加载失败')
    }
  }, [])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    setError('')
    void getHumanTask(selectedId)
      .then((nextDetail) => {
        setDetail(nextDetail)
        setEditedContent(nextDetail.artifact.content)
        setIsEditing(false)
        setReason('')
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : '人工任务详情加载失败')
      })
  }, [selectedId])

  const filteredTasks = useMemo(() => tasks.filter((task) => (
    (statusFilter === '全部' || task.status === statusFilter)
    && (slaFilter === '全部' || task.slaStatus === slaFilter)
  )), [slaFilter, statusFilter, tasks])

  const currentOperator = reviewers.find((reviewer) => reviewer.id === operatorId)
  const selectedCandidate = candidates.find((candidate) => candidate.humanTaskId === selectedId)
  const selectedGroup = groups.find((group) => group.id === detail?.assigneeGroupId)
  const isTerminal = detail ? terminalStatuses.has(detail.status) : true

  function updateTask(nextTask: HumanTask) {
    setTasks((current) => current.map((task) => (
      task.id === nextTask.id ? { ...task, ...nextTask } : task
    )))
  }

  async function claim() {
    if (!detail || !operatorId) return
    setIsBusy(true)
    setError('')
    try {
      const updated = await claimHumanTask(detail.id, operatorId)
      updateTask(updated)
      setDetail((current) => current ? { ...current, ...updated } : current)
      setMessage('任务已认领')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '任务认领失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function transfer() {
    if (!detail || !operatorId) return
    if (!transferReviewerId || !transferReason.trim()) {
      setError('请选择转交审核人并填写转交原因')
      return
    }
    setIsBusy(true)
    setError('')
    try {
      const updated = await transferHumanTask(detail.id, {
        actorId: operatorId,
        reviewerId: transferReviewerId,
        reason: transferReason.trim(),
      })
      updateTask(updated)
      setDetail((current) => current ? { ...current, ...updated } : current)
      setTransferReason('')
      setMessage('任务已转交')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '任务转交失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function decide(decision: HumanTaskDecision) {
    if (!detail || !operatorId) return
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
      const updated = await decideHumanTask(detail.id, {
        reviewerId: operatorId,
        decision,
        reason: reason.trim(),
        artifactVersionId: detail.artifact.id,
        idempotencyKey: `${detail.id}:${operatorId}:${decision}:${Date.now()}`,
        ...(decision === 'modify_and_approve'
          ? { modifiedContent: editedContent.trim(), tags: ['人工修订'] }
          : {}),
      })
      setDetail(updated)
      setEditedContent(updated.artifact.content)
      updateTask(updated)
      setMessage('审核决定已提交')
      setReason('')
      setIsEditing(false)
      setCandidates(await listFeedbackCandidates())
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
      const updated = await retryHumanTaskResume(detail.id)
      setDetail(updated)
      updateTask(updated)
      setMessage('工作流恢复已重试')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '恢复重试失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function confirmGolden() {
    if (!selectedCandidate || !currentOperator?.isExpert) return
    if (!expertReason.trim()) {
      setError('请填写专家确认理由')
      return
    }
    setIsBusy(true)
    setError('')
    try {
      await confirmFeedbackCandidate(selectedCandidate.id, {
        reviewerId: currentOperator.id,
        reason: expertReason.trim(),
        idempotencyKey: `${selectedCandidate.id}:${currentOperator.id}:golden`,
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
    return <div className="panel table-state">暂无人工任务。</div>
  }

  return (
    <div className="review-workbench">
      {message && <div className="toast"><Check size={16} />{message}</div>}
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
              <option>全部</option>
              <option>待认领</option>
              <option>审核中</option>
              <option>恢复失败</option>
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
          {filteredTasks.map((task) => (
            <button
              className={`review-task-row ${task.id === selectedId ? 'selected' : ''}`}
              key={task.id}
              onClick={() => {
                setSelectedId(task.id)
                setMobilePane('review')
              }}
            >
              <div><StatusBadge status={task.status} /><span className={`sla-dot ${task.slaStatus}`}>{task.slaStatus}</span></div>
              <strong>{task.title}</strong>
              <span>{task.id}</span>
              <small><Clock3 size={13} />{formatTime(task.dueAt)}</small>
            </button>
          ))}
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
              <label>
                <span>当前操作者</span>
                <select aria-label="当前操作者" value={operatorId} onChange={(event) => setOperatorId(event.target.value)}>
                  {reviewers.map((reviewer) => (
                    <option value={reviewer.id} key={reviewer.id}>
                      {reviewer.name} · {reviewer.role}
                    </option>
                  ))}
                </select>
              </label>
              {!detail.assigneeReviewerId && !isTerminal && (
                <button className="button secondary" disabled={isBusy} onClick={() => void claim()}>
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
              <button className="button danger" disabled={isBusy || isTerminal} onClick={() => void decide('reject')}>
                <X size={15} />驳回
              </button>
              <button className="button secondary" disabled={isBusy || isTerminal} onClick={() => void decide('return_for_rerun')}>
                <RotateCcw size={15} />退回重跑
              </button>
              <button className="button secondary" disabled={isBusy || isTerminal} onClick={() => void decide('approve')}>
                <Check size={15} />通过
              </button>
              <button className="button primary" disabled={isBusy || isTerminal} onClick={() => void decide('modify_and_approve')}>
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
              <div><span>SLA</span><strong>{detail.slaStatus}</strong></div>
              <div><span>审核组</span><strong>{selectedGroup?.name ?? '未分组'}</strong></div>
            </section>

            <section className="context-section">
              <div className="context-title"><ArrowRightLeft size={15} /><h3>任务转交</h3></div>
              <label>
                <span>转交审核人</span>
                <select aria-label="转交审核人" value={transferReviewerId} onChange={(event) => setTransferReviewerId(event.target.value)}>
                  <option value="">请选择</option>
                  {reviewers.filter((reviewer) => reviewer.id !== operatorId).map((reviewer) => (
                    <option value={reviewer.id} key={reviewer.id}>{reviewer.name} · {reviewer.role}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>转交原因</span>
                <input aria-label="转交原因" value={transferReason} onChange={(event) => setTransferReason(event.target.value)} />
              </label>
              <button className="button secondary full" disabled={isBusy || isTerminal} onClick={() => void transfer()}>
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
                {currentOperator?.isExpert && selectedCandidate.status === '待确认' ? (
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
  )
}
