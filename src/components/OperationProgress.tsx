import { useEffect, useId, useRef, useState } from 'react'
import { controlOperation, getOperation, operationStatusLabels, operationUpdatedEvent, reconcileOperation, type Operation } from '../api/operations'
import { ApiError } from '../api/http'
import './OperationProgress.css'

const terminal = new Set(['succeeded', 'failed', 'dead_letter', 'canceled'])
interface Props {
  workspaceId: string
  operationId: string
  canExecute: boolean
  canReconcile: boolean
  onDismiss?: () => void
  workspacePath?: (path: string) => string
}

/** Poll persisted state without owning execution; switching workspace/unmount aborts all reads. */
export function OperationProgress({ workspaceId, operationId, canExecute, canReconcile, onDismiss, workspacePath }: Props) {
  const [operation, setOperation] = useState<Operation | null>(null)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const active = useRef(true)
  const accessDenied = useRef(false)
  const reasonId = useId()

  useEffect(() => {
    active.current = true
    accessDenied.current = false
    let disposed = false
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    let lastStatus = ''
    const poll = async () => {
      if (accessDenied.current) return
      try {
        timeout = setTimeout(() => { timedOut = true; controller.abort() }, 15000)
        const next = await getOperation(workspaceId, operationId, controller.signal)
        clearTimeout(timeout)
        if (disposed || accessDenied.current) return
        if (next.operationId !== operationId || !Object.hasOwn(operationStatusLabels, next.status)) throw new Error('任务状态响应格式异常')
        setOperation(next)
        setError('')
        if (lastStatus !== next.status) {
          lastStatus = next.status
          window.dispatchEvent(new CustomEvent(operationUpdatedEvent, { detail: { workspaceId, operation: next } }))
        }
        if (!terminal.has(next.status)) timer = setTimeout(() => void poll(), 3000)
      } catch (pollError) {
        if (!disposed) {
          if (pollError instanceof ApiError && [401, 403, 404].includes(pollError.status)) { accessDenied.current = true; setOperation(null) }
          setError(timedOut ? '任务状态查询超时，请重试查询；任务未被重新提交' : pollError instanceof Error ? pollError.message : '任务查询失败')
        }
      } finally {
        clearTimeout(timeout)
      }
    }
    void poll()
    return () => { disposed = true; active.current = false; controller.abort(); clearTimeout(timer); clearTimeout(timeout) }
  }, [workspaceId, operationId, revision])

  async function act(action: 'cancel' | 'requeue' | 'retry' | 'fail') {
    setBusy(true)
    setError('')
    try {
      const next = action === 'retry' || action === 'fail'
        ? await reconcileOperation(workspaceId, operationId, { decision: action, reason: reason.trim(), acknowledgeDuplicateRisk: acknowledged })
        : await controlOperation(workspaceId, operationId, action, reason.trim())
      if (!active.current) return
      setOperation(next)
      setReason('')
      setAcknowledged(false)
      setRevision((value) => value + 1)
    } catch (actionError) {
      if (active.current) {
        if (actionError instanceof ApiError && [401, 403, 404].includes(actionError.status)) { accessDenied.current = true; setOperation(null) }
        setError(actionError instanceof Error ? actionError.message : '任务操作失败')
      }
    } finally {
      if (active.current) setBusy(false)
    }
  }

  const uncertain = operation?.status === 'needs_reconciliation'
  const controllable = operation && canExecute && ['queued', 'running', 'waiting_review', 'failed', 'dead_letter'].includes(operation.status)
  return <section className="panel operation-progress" aria-label={`异步任务 ${operationId}`}>
    <div className="panel-heading"><strong>异步任务</strong><code>{operationId}</code></div>
    <p role="status">{operation ? operationStatusLabels[operation.status] : error ? '无法读取当前任务状态' : '正在查询任务状态…'}</p>
    {operation && <p>尝试次数：{operation.attempts} · {operation.kind}</p>}
    {operation?.updatedAt && <p>最近持久化更新：{operation.updatedAt}</p>}
    {uncertain && <p>外部调用可能已经执行，已暂停自动重发。请核对服务方记录后再决定；取消不能撤销已执行的外部动作。</p>}
    {operation?.status === 'waiting_review' && workspacePath && <a href={workspacePath('reviews')}>前往人工审核</a>}
    {operation?.runId && workspacePath && <a href={workspacePath(`runs?runId=${encodeURIComponent(operation.runId)}`)}>查看关联运行</a>}
    {operation?.status === 'succeeded' && operation.result != null && <details><summary>查看持久化结果</summary><pre>{JSON.stringify(operation.result, null, 2)}</pre></details>}
    {operation?.error != null && <p role="alert">{typeof operation.error === 'string' ? operation.error : JSON.stringify(operation.error)}</p>}
    {(controllable || (uncertain && canReconcile)) && <div>
      <label htmlFor={reasonId}>核对依据 / 操作原因</label>
      <input id={reasonId} value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} disabled={busy} />
      {uncertain && canReconcile ? <>
        <label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busy} />我已核对，接受重复调用或重复计费的风险</label>
        <button type="button" className="button secondary" disabled={busy || !reason.trim() || !acknowledged} onClick={() => void act('retry')}>确认风险并重新尝试</button>
        <button type="button" className="button secondary" disabled={busy || !reason.trim()} onClick={() => void act('fail')}>确认失败，不重发</button>
      </> : <button type="button" className="button secondary" disabled={busy || !reason.trim()} onClick={() => void act(operation && ['failed', 'dead_letter'].includes(operation.status) ? 'requeue' : 'cancel')}>
        {operation && ['failed', 'dead_letter'].includes(operation.status) ? '重新排队' : '取消后续执行'}
      </button>}
    </div>}
    {error && <div role="alert">{error}<button type="button" className="button secondary" onClick={() => setRevision((value) => value + 1)}>重试查询</button></div>}
    {operation && terminal.has(operation.status) && onDismiss && <button className="button secondary" type="button" onClick={onDismiss}>关闭已结束任务</button>}
  </section>
}
