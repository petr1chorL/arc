import { useEffect, useRef, useState } from 'react'
import { claimHumanTask, decideHumanTask, getHumanTask, transferHumanTask } from '../api/humanTasks'
import type { HumanTaskDetail, Reviewer, ReviewGroup } from '../types'
import './OperationProgress.css'

interface Props {
  workspaceId: string; detail: HumanTaskDetail; reviewers: Reviewer[]; groups: ReviewGroup[]
  reviewer: Reviewer | undefined; canDecide: boolean; onChanged: (detail: HumanTaskDetail) => void
}

/** Native review controls keep roster, artifact version and approval progress visible. Server rechecks all permissions. */
export function NativeReviewControls({ workspaceId, detail, reviewers, groups, reviewer, canDecide, onChanged }: Props) {
  const [reason, setReason] = useState('')
  const [content, setContent] = useState(detail.artifact.content)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const terminal = ['已通过', '修改后通过', '已驳回', '已退回', '恢复失败'].includes(detail.status)
  const participating = reviewer?.isActive && detail.participantSnapshot.includes(reviewer.id)
  const canClaim = participating && detail.status === '待认领' && !detail.assigneeReviewerId
  const canTransfer = participating && !terminal && detail.assigneeReviewerId === reviewer.id

  async function act(action: 'claim' | 'transfer' | 'modify' | 'return') {
    setBusy(true)
    setError('')
    try {
      let updated: HumanTaskDetail
      if (action === 'claim' || action === 'transfer') {
        if (action === 'claim') await claimHumanTask(workspaceId, detail.id)
        else await transferHumanTask(workspaceId, detail.id, {
          ...(target.startsWith('group:') ? { groupId: target.slice(6) } : { targetReviewerId: target.slice(9) }), reason: reason.trim(),
        })
        updated = await getHumanTask(workspaceId, detail.id)
      } else updated = await decideHumanTask(workspaceId, detail.id, {
        decision: action === 'modify' ? 'modify_and_approve' : 'return_for_rerun', reason: reason.trim(),
        artifactVersionId: detail.artifact.id, idempotencyKey: crypto.randomUUID(),
        ...(action === 'modify' ? { modifiedContent: content } : {}),
      })
      if (mounted.current) {
        onChanged(updated)
        setReason('')
        window.dispatchEvent(new Event('human-tasks-updated'))
      }
    } catch (actionError) { if (mounted.current) setError(actionError instanceof Error ? actionError.message : '审核操作失败') }
    finally { if (mounted.current) setBusy(false) }
  }

  return <section className="panel native-review-controls" aria-label="审核协作与版本修订">
    <p>审核策略：{detail.reviewPolicy} · 已批准 {detail.approvalProgress.received} / {detail.approvalProgress.required}</p>
    {canClaim && <button type="button" className="button secondary" disabled={busy} onClick={() => void act('claim')}>认领审核任务</button>}
    {(canTransfer || canDecide) && !terminal && <>
      <label>修改 / 转交依据<input aria-label="修改 / 转交依据" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
      {canTransfer && <div>
        <label>转交对象<select aria-label="转交对象" value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy}>
          <option value="">请选择固定参与范围内的审核员或审核组</option>
          {reviewers.filter((item) => item.isActive && item.id !== reviewer?.id && detail.participantSnapshot.includes(item.id))
            .map((item) => <option key={item.id} value={`reviewer:${item.id}`}>{item.name}</option>)}
          {groups.filter((group) => group.members.some((item) => item.isActive && detail.participantSnapshot.includes(item.id)))
            .map((group) => <option key={group.id} value={`group:${group.id}`}>{group.name}</option>)}
        </select></label>
        <button type="button" className="button secondary" disabled={busy || !target || !reason.trim()} onClick={() => void act('transfer')}>转交任务</button>
      </div>}
      {canDecide && <div>
        <label>修改后的产出物<textarea aria-label="修改后的产出物" value={content} onChange={(event) => setContent(event.target.value)} disabled={busy} /></label>
        <p>修改将新增产出物版本，保留原始内容；当前版本 v{detail.artifact.version}。</p>
        <button type="button" className="button secondary" disabled={busy || !reason.trim() || !content.trim() || content === detail.artifact.content} onClick={() => void act('modify')}>修改后批准</button>
        <button type="button" className="button secondary" disabled={busy || !reason.trim()} onClick={() => void act('return')}>退回待重跑</button>
      </div>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>
}
