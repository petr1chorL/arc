import { Check, Clock3, FileText, RefreshCw, UserCheck, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { decideReview, getRun, listReviews, type ReviewDecision } from '../api/execution'
import { StatusBadge } from '../components/StatusBadge'
import type { ExecutionRun, HumanReview } from '../types'

export function Reviews() {
  const [reviews, setReviews] = useState<HumanReview[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [run, setRun] = useState<ExecutionRun | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const selected = reviews.find((review) => review.id === selectedId) ?? reviews[0]

  const loadReviews = useCallback(async () => {
    setError('')
    try {
      const nextReviews = await listReviews()
      setReviews(nextReviews)
      setSelectedId((current) => (
        nextReviews.some((review) => review.id === current) ? current : nextReviews[0]?.id ?? ''
      ))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '审核任务加载失败')
    }
  }, [])

  useEffect(() => {
    void loadReviews()
  }, [loadReviews])

  useEffect(() => {
    if (!selected) {
      setRun(null)
      return
    }
    void getRun(selected.runId)
      .then(setRun)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '关联运行加载失败'))
  }, [selected])

  async function act(decision: ReviewDecision) {
    if (!selected) return
    setIsBusy(true)
    setError('')
    try {
      const updated = await decideReview(selected.id, decision)
      setReviews((current) => current.map((review) => review.id === updated.id ? updated : review))
      setMessage(decision === 'approve' ? '审核已通过' : '审核已驳回')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '审核决策提交失败')
    } finally {
      setIsBusy(false)
    }
  }

  if (error && reviews.length === 0) {
    return (
      <div className="panel table-state error" role="alert">
        {error}
        <button className="button secondary" onClick={() => void loadReviews()}>
          <RefreshCw size={15} />重试
        </button>
      </div>
    )
  }
  if (!selected) {
    return <div className="panel table-state">暂无人工审核任务。</div>
  }

  return (
    <div className="review-layout">
      {message && <div className="toast"><Check size={16} />{message}</div>}
      <section className="review-queue panel">
        <div className="queue-heading">
          <div><span className="section-kicker">人工质量门禁</span><h3>审核任务</h3></div>
          <span className="queue-count">{reviews.length}</span>
        </div>
        {reviews.map((review) => (
          <button
            className={`review-item ${selected.id === review.id ? 'selected' : ''}`}
            key={review.id}
            onClick={() => setSelectedId(review.id)}
          >
            <div className="review-item-top"><StatusBadge status={review.status} /><small>{review.id}</small></div>
            <strong>{review.title}</strong>
            <span>运行 {review.runId}</span>
            <div><Clock3 size={14} />{new Date(review.createdAt).toLocaleString('zh-CN')}</div>
          </button>
        ))}
      </section>

      <section className="review-detail panel">
        <header>
          <div>
            <span className="mono">{selected.id}</span>
            <h2>{selected.title}</h2>
            <p>{run?.name ?? '正在加载关联运行…'}</p>
          </div>
          <div className="review-score">
            <span>质量得分</span><strong>{selected.score}</strong><small><StatusBadge status={selected.status} /></small>
          </div>
        </header>

        {error && <div className="inline-feedback error" role="alert">{error}</div>}
        <div className="review-notice">
          <UserCheck size={19} />
          <div><strong>为什么需要人工判断</strong><span>{selected.reason}</span></div>
        </div>

        <div className="review-section">
          <div className="review-section-title"><FileText size={16} /><h3>Agent 产出</h3></div>
          <div className="artifact-preview">
            <span>{run?.model || '模型信息加载中'}</span>
            <p>{run?.output || run?.error || '正在加载产出内容…'}</p>
          </div>
        </div>

        <footer className="review-footer">
          <button
            className="button danger"
            disabled={isBusy || selected.status !== '待处理'}
            onClick={() => void act('reject')}
          >
            <X size={16} />驳回
          </button>
          <button
            className="button primary"
            disabled={isBusy || selected.status !== '待处理'}
            onClick={() => void act('approve')}
          >
            <Check size={16} />通过
          </button>
        </footer>
      </section>
    </div>
  )
}
