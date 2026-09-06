import { useState } from 'react'
import { useAuth } from '../auth/authContext'
import { useWorkspace } from '../auth/workspaceContextState'
import { workspaceHasCapability } from '../auth/workspaceCapabilities'
import { rerunWorkflowRun, resumeRunFromFailedNode } from '../api/execution'
import { isAcceptedOperation } from '../api/operations'
import type { ExecutionRun } from '../types'
import { useOperationNotice } from '../domain/useOperationNotice'

/** Runtime-only actions never claim that an accepted rerun has finished. */
export function NativeRunActions({ run, onChanged }: { run: ExecutionRun; onChanged: () => Promise<void> }) {
  const { user } = useAuth()
  const { workspace } = useWorkspace()
  const operationNotice = useOperationNotice(workspace.id)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  if (run.kind !== 'workflow' || !workspaceHasCapability(workspace, user?.isOrganizationAdmin, 'run.execute')) return null
  async function submit(resume: boolean) {
    setBusy(true)
    setNotice('')
    try {
      const result = await (resume ? resumeRunFromFailedNode(workspace.id, run.id) : rerunWorkflowRun(workspace.id, run.id))
      if (isAcceptedOperation(result)) operationNotice.accepted(result, '运行任务', '请求已接收，尚未完成；请查看异步任务进度。')
      else setNotice('运行记录已更新')
      await onChanged()
    } catch (error) { setNotice(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(false) }
  }
  return <div>
    <button type="button" className="button secondary" disabled={busy} onClick={() => void submit(false)}>创建重跑任务</button>
    {['失败', '恢复失败', 'failed'].includes(run.status) && <button type="button" className="button secondary" disabled={busy} onClick={() => void submit(true)}>从失败节点恢复</button>}
    {notice && <p role="status">{notice}</p>}
    {operationNotice.notice && <p role="status">{operationNotice.notice}</p>}
  </div>
}
