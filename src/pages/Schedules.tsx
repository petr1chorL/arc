import './Schedules.css'
import { CalendarClock, ChevronDown, CirclePause, CirclePlay, History, Pencil, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  createSchedule,
  listScheduleDispatches,
  listSchedules,
  setScheduleStatus,
  triggerSchedule,
  updateSchedule,
  type ScheduleDispatch,
  type WorkflowSchedule,
  type WorkflowScheduleInput,
} from '../api/schedules'
import { listWorkflows, listWorkflowVersions } from '../api/workflows'
import { useWorkspace } from '../auth/workspaceContextState'
import type { WorkflowDraft, WorkflowVersion } from '../types'

const initialForm: WorkflowScheduleInput = {
  name: '',
  workflowId: '',
  workflowVersion: '',
  cronExpression: '0 9 * * 1-5',
  timezone: 'Asia/Shanghai',
  input: '{}',
  status: 'active',
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(value))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试'
}

export function Schedules() {
  const { workspace } = useWorkspace()
  const [schedules, setSchedules] = useState<WorkflowSchedule[]>([])
  const [workflows, setWorkflows] = useState<WorkflowDraft[]>([])
  const [versions, setVersions] = useState<WorkflowVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<WorkflowScheduleInput>(initialForm)
  const [formError, setFormError] = useState('')
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [history, setHistory] = useState<ScheduleDispatch[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([listSchedules(workspace.id), listWorkflows(workspace.id)])
      .then(([scheduleItems, workflowItems]) => {
        if (!active) return
        setSchedules(scheduleItems)
        setWorkflows(workflowItems)
        setError('')
      })
      .catch((loadError) => active && setError(errorMessage(loadError)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [workspace.id])

  const selectedWorkflow = useMemo(
    () => workflows.find((item) => item.id === form.workflowId),
    [form.workflowId, workflows],
  )

  async function loadVersions(workflowId: string, selectedVersion = '') {
    if (!workflowId) {
      setVersions([])
      setForm((current) => ({ ...current, workflowId: '', workflowVersion: '' }))
      return
    }
    try {
      const items = await listWorkflowVersions(workspace.id, workflowId)
      setVersions(items)
      setForm((current) => ({
        ...current,
        workflowId,
        workflowVersion: selectedVersion || items[0]?.version || '',
      }))
    } catch (loadError) {
      setVersions([])
      setFormError(errorMessage(loadError))
    }
  }

  function openCreate() {
    setEditingId(null)
    setForm(initialForm)
    setVersions([])
    setFormError('')
    setDialogOpen(true)
  }

  function openEdit(schedule: WorkflowSchedule) {
    setEditingId(schedule.id)
    setForm({
      name: schedule.name,
      workflowId: schedule.workflowId,
      workflowVersion: schedule.workflowVersion,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      input: schedule.input,
    })
    setFormError('')
    setDialogOpen(true)
    void loadVersions(schedule.workflowId, schedule.workflowVersion)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFormError('')
    if (!form.name.trim() || !form.workflowId || !form.workflowVersion || !form.cronExpression.trim()) {
      setFormError('请完整填写调度名称、工作流版本和 Cron 表达式')
      return
    }
    try {
      JSON.parse(form.input)
    } catch {
      setFormError('运行参数必须是合法 JSON')
      return
    }
    setSaving(true)
    try {
      const saved = editingId
        ? await updateSchedule(workspace.id, editingId, form)
        : await createSchedule(workspace.id, form)
      setSchedules((items) => editingId
        ? items.map((item) => item.id === editingId ? saved : item)
        : [saved, ...items])
      setDialogOpen(false)
      setNotice(editingId ? '调度计划已更新' : '调度计划已创建')
    } catch (saveError) {
      setFormError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(schedule: WorkflowSchedule) {
    setError('')
    const nextStatus = schedule.status === 'active' ? 'paused' : 'active'
    try {
      const updated = await setScheduleStatus(workspace.id, schedule.id, nextStatus)
      setSchedules((items) => items.map((item) => item.id === schedule.id ? updated : item))
      setNotice(nextStatus === 'active' ? '调度计划已恢复' : '调度计划已暂停')
    } catch (statusError) {
      setError(errorMessage(statusError))
    }
  }

  async function trigger(schedule: WorkflowSchedule) {
    setError('')
    try {
      const dispatch = await triggerSchedule(workspace.id, schedule.id)
      setNotice(dispatch.runId ? `已创建运行 ${dispatch.runId}` : `本次触发${dispatch.status}`)
      const refreshed = await listSchedules(workspace.id)
      setSchedules(refreshed)
    } catch (triggerError) {
      setError(errorMessage(triggerError))
    }
  }

  async function toggleHistory(schedule: WorkflowSchedule) {
    if (historyId === schedule.id) {
      setHistoryId(null)
      return
    }
    setHistoryId(schedule.id)
    setHistory([])
    try {
      setHistory(await listScheduleDispatches(workspace.id, schedule.id))
    } catch (historyError) {
      setError(errorMessage(historyError))
    }
  }

  return (
    <div className="schedule-center">
      <section className="schedule-hero panel">
        <div>
          <span className="eyebrow">WORKFLOW SCHEDULER</span>
          <h2>调度中心</h2>
          <p>为已发布的工作流版本配置定时运行，统一查看下一次执行和派发结果。</p>
        </div>
        <button className="button primary" onClick={openCreate}><Plus size={16} />新建调度</button>
      </section>

      {error && <div className="panel table-state error" role="alert">{error}</div>}
      {notice && <div className="schedule-notice" role="status">{notice}</div>}

      <section className="schedule-list panel" aria-label="调度计划列表">
        <header className="schedule-list-header">
          <div><CalendarClock size={19} /><strong>调度计划</strong></div>
          <span>{schedules.length} 个计划</span>
        </header>
        {loading && <div className="table-state">正在加载调度计划…</div>}
        {!loading && schedules.length === 0 && <div className="table-state">暂无调度计划，创建一个开始自动运行。</div>}
        {!loading && schedules.map((schedule) => (
          <article className="schedule-row" key={schedule.id}>
            <div className="schedule-row-main">
              <div className="schedule-name">
                <strong>{schedule.name}</strong>
                <span className={`status-pill ${schedule.status}`}>{schedule.status === 'active' ? '运行中' : '已暂停'}</span>
              </div>
              <span>{schedule.workflowName} · {schedule.workflowVersion}</span>
            </div>
            <div className="schedule-cron">
              <code>{schedule.cronExpression}</code>
              <span>{schedule.timezone}</span>
            </div>
            <div className="schedule-time"><small>下次执行</small><strong>{formatDate(schedule.nextRunAt)}</strong></div>
            <div className="schedule-time"><small>最近运行</small><strong>{schedule.lastRunStatus ?? '尚未运行'}</strong></div>
            <div className="schedule-actions">
              <button className="button ghost compact" aria-label={`立即执行 ${schedule.name}`} onClick={() => void trigger(schedule)}><CirclePlay size={15} />立即执行</button>
              <button className="button ghost compact" aria-label={`${schedule.status === 'active' ? '暂停' : '恢复'} ${schedule.name}`} onClick={() => void changeStatus(schedule)}>
                {schedule.status === 'active' ? <CirclePause size={15} /> : <CirclePlay size={15} />}
                {schedule.status === 'active' ? '暂停' : '恢复'}
              </button>
              <button className="icon-button" aria-label={`编辑 ${schedule.name}`} onClick={() => openEdit(schedule)}><Pencil size={15} /></button>
              <button className="icon-button" aria-label={`运行记录 ${schedule.name}`} onClick={() => void toggleHistory(schedule)}><History size={15} /></button>
            </div>
            {historyId === schedule.id && (
              <div className="schedule-history">
                <h3>运行记录</h3>
                {history.length === 0 && <p>暂无派发记录</p>}
                {history.map((item) => (
                  <div key={item.id}>
                    <span className={`dispatch-status ${item.status}`}>{item.status}</span>
                    <span>{formatDate(item.scheduledFor)}</span>
                    <span>{item.runStatus || item.reason || '—'}</span>
                    {item.runId && <a href={`/w/${workspace.slug}/runs?runId=${item.runId}`}>{item.runId}</a>}
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      {dialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="agent-dialog schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-dialog-title">
            <header>
              <div><span className="eyebrow">SCHEDULE CONFIG</span><h2 id="schedule-dialog-title">{editingId ? '编辑调度' : '新建调度'}</h2></div>
              <button className="icon-button" aria-label="关闭调度配置" onClick={() => setDialogOpen(false)}><X size={17} /></button>
            </header>
            <form onSubmit={(event) => void submit(event)}>
              <label className="form-field full"><span>调度名称</span><input aria-label="调度名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label className="form-field"><span>工作流</span><span className="select-wrap"><select aria-label="工作流" value={form.workflowId} onChange={(event) => void loadVersions(event.target.value)}><option value="">请选择已发布工作流</option>{workflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></span></label>
              <label className="form-field"><span>固定版本</span><span className="select-wrap"><select aria-label="固定版本" value={form.workflowVersion} onChange={(event) => setForm({ ...form, workflowVersion: event.target.value })} disabled={!selectedWorkflow}><option value="">请选择版本</option>{versions.map((item) => <option key={item.id} value={item.version}>{item.version}</option>)}</select><ChevronDown size={15} /></span></label>
              <label className="form-field"><span>Cron 表达式</span><input aria-label="Cron 表达式" value={form.cronExpression} onChange={(event) => setForm({ ...form, cronExpression: event.target.value })} /><small>五段 Cron：分 时 日 月 星期</small></label>
              <label className="form-field"><span>时区</span><input aria-label="时区" value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></label>
              <label className="form-field full"><span>运行参数 JSON</span><textarea aria-label="运行参数 JSON" rows={6} value={form.input} onChange={(event) => setForm({ ...form, input: event.target.value })} /></label>
              {formError && <div className="form-error full" role="alert">{formError}</div>}
              <footer><button type="button" className="button ghost" onClick={() => setDialogOpen(false)}>取消</button><button type="submit" className="button primary" disabled={saving}>{saving ? '保存中…' : '保存调度'}</button></footer>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
