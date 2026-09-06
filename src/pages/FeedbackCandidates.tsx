import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../auth/workspaceContextState'
import { confirmFeedbackCandidate, getFeedbackCandidate, listFeedbackCandidates } from '../api/humanTasks'
import type { FeedbackCandidate, GoldenSample } from '../types'

/** Migration-only candidate governance; never loads tasks, reviewer directories or executions. */
export function FeedbackCandidates() {
  const { workspace } = useWorkspace()
  return <CandidatePanel key={workspace.id} workspaceId={workspace.id} />
}

function CandidatePanel({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<FeedbackCandidate[]>([])
  const [detail, setDetail] = useState<FeedbackCandidate | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sample, setSample] = useState<GoldenSample | null>(null)
  const [attempt, setAttempt] = useState<{ reason: string; idempotencyKey: string } | null>(null)
  const [reload, setReload] = useState(0)
  const selection = useRef(0)
  const listGeneration = useRef(0)
  const attempts = useRef(new Map<string, { reason: string; idempotencyKey: string }>())
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let active = true
    const generation = ++listGeneration.current
    listFeedbackCandidates(workspaceId).then(rows => { if (active && generation === listGeneration.current) setItems(rows) })
      .catch(cause => { if (active && generation === listGeneration.current) setError(message(cause)) })
      .finally(() => { if (active && generation === listGeneration.current) setLoading(false) })
    return () => { active = false }
  }, [workspaceId, reload])

  async function select(id: string) {
    const current = ++selection.current
    const previous = attempts.current.get(id) ?? null
    setDetail(null); setError(''); setSample(null); setReason(previous?.reason ?? ''); setAttempt(previous)
    try {
      const row = await getFeedbackCandidate(workspaceId, id)
      if (alive.current && current === selection.current) setDetail(row)
    } catch (cause) { if (alive.current && current === selection.current) setError(message(cause)) }
  }

  async function confirm() {
    if (!detail || saving || sample) return
    const body = attempt ?? { reason, idempotencyKey: crypto.randomUUID() }
    attempts.current.set(detail.id, body)
    setAttempt(body); setSaving(true); setError('')
    try {
      const created = await confirmFeedbackCandidate(workspaceId, detail.id, body)
      if (!alive.current) return
      setSample(created)
      setDetail({ ...detail, status: '已确认' })
      const generation = ++listGeneration.current
      try { const rows = await listFeedbackCandidates(workspaceId); if (alive.current && generation === listGeneration.current) setItems(rows) }
      catch (cause) { if (alive.current && generation === listGeneration.current) setError(`确认已成功，但列表刷新失败：${message(cause)}`) }
      finally { if (alive.current && generation === listGeneration.current) setLoading(false) }
    } catch (cause) { if (alive.current) setError(message(cause)) }
    finally { if (alive.current) setSaving(false) }
  }

  return <main className="page-stack feedback-candidate-governance">
    <header className="page-toolbar"><div><p className="eyebrow">FEEDBACK CANDIDATES</p><h1>反馈候选治理</h1><p>迁移验证模式：仅治理既有候选，运行与人工任务生成尚未迁移。专家资格由服务端核验。</p></div></header>
    {error && <div role="alert" className="inline-feedback error">{error}</div>}
    <button className="button secondary" type="button" disabled={loading || saving} onClick={() => { setError(''); setLoading(true); setReload(value => value + 1) }}>刷新候选</button>
    <section className="panel candidate-list" aria-label="反馈候选列表">
      {loading ? <p>正在加载候选…</p> : !error && items.length === 0 ? <p>暂无反馈候选</p> : null}
      {items.map(item => <button className="button secondary" type="button" key={item.id} aria-pressed={detail?.id === item.id} disabled={saving} onClick={() => void select(item.id)}>
        查看候选 {item.id} · {item.status}
      </button>)}
    </section>
    {detail && <section className="panel candidate-detail">
      <h2>候选 {detail.id}</h2><p>状态：{detail.status}</p>
      <p>来源：运行 {detail.workflowRunId} / 人工任务 {detail.humanTaskId} / 节点 {detail.sourceNodeId}</p>
      <h3>原始版本 {detail.originalVersionId}</h3><pre>{detail.originalContent}</pre>
      <h3>修改版本 {detail.modifiedVersionId}</h3><pre>{detail.modifiedContent}</pre>
      <h3>差异</h3><pre>{detail.unifiedDiff}</pre><p>修改理由：{detail.reason}</p><p>标签：{detail.tags.join('、')}</p>
      {detail.status === '待确认' && <><label>确认理由<textarea value={reason} disabled={saving || attempt !== null}
        onChange={event => setReason(event.target.value)} maxLength={4000} /></label>
      <button className="button primary" type="button" disabled={saving || reason.length === 0} onClick={() => void confirm()}>{saving ? '正在确认…' : attempt ? '重试确认' : '确认黄金样本'}</button>
      {attempt && <p>重试沿用首次确认理由和幂等键。</p>}</>}
      {sample && <div role="status"><p>黄金样本已确认：{sample.id}</p><pre>{sample.expectedOutput}</pre></div>}
    </section>}
  </main>
}

function message(cause: unknown): string { return cause instanceof Error ? cause.message : '候选请求失败，请重试' }
