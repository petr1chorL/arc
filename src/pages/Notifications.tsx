import { AlertTriangle, Bell, CheckCircle2, Clock3, Filter, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listNotifications } from '../api/notifications'
import { useWorkspace } from '../auth/workspaceContextState'
import { StatusBadge } from '../components/StatusBadge'
import type { NotificationOutboxItem } from '../types'

const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '失败', value: 'failed' },
  { label: '待发送', value: 'pending' },
  { label: '已发送', value: 'sent' },
]

const channelOptions = [
  { label: '全部渠道', value: '' },
  { label: 'in_app', value: 'in_app' },
  { label: 'webhook', value: 'webhook' },
  { label: 'email', value: 'email' },
]

const errorCodeOptions = [
  { label: '全部失败码', value: '' },
  { label: 'channel_not_configured', value: 'channel_not_configured' },
  { label: 'channel_disabled', value: 'channel_disabled' },
  { label: 'provider_timeout', value: 'provider_timeout' },
]

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

function dispatchPayload(notification: NotificationOutboxItem) {
  const dispatch = notification.payload.dispatch
  return typeof dispatch === 'object' && dispatch !== null && !Array.isArray(dispatch)
    ? dispatch as Record<string, unknown>
    : {}
}

function notificationChannel(notification: NotificationOutboxItem) {
  const dispatch = dispatchPayload(notification)
  const dispatchedChannel = dispatch.channel
  if (typeof dispatchedChannel === 'string' && dispatchedChannel) return dispatchedChannel
  const directChannel = notification.payload.channel
  if (typeof directChannel === 'string' && directChannel) return directChannel
  const channels = notification.payload.channels
  if (Array.isArray(channels)) {
    const first = channels.find((candidate) => typeof candidate === 'string' && candidate)
    if (typeof first === 'string') return first
  }
  return '未声明'
}

function notificationErrorCode(notification: NotificationOutboxItem) {
  const dispatch = dispatchPayload(notification)
  const errorCode = dispatch.errorCode ?? dispatch.error_code
  return typeof errorCode === 'string' && errorCode ? errorCode : '无'
}

function notificationError(notification: NotificationOutboxItem) {
  const dispatch = dispatchPayload(notification)
  const error = dispatch.error
  return typeof error === 'string' && error ? error : '无错误文本'
}

function messageText(notification: NotificationOutboxItem) {
  const message = notification.payload.message
  return typeof message === 'string' && message ? message : notification.eventType
}

export function Notifications() {
  const { workspace } = useWorkspace()
  const [items, setItems] = useState<NotificationOutboxItem[]>([])
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const loadNotifications = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      setItems(await listNotifications(workspace.id, {
        status: status || undefined,
        channel: channel || undefined,
        errorCode: errorCode || undefined,
        limit: 50,
      }))
    } catch (loadError) {
      setItems([])
      setError(loadError instanceof Error ? loadError.message : '通知 Outbox 加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [channel, errorCode, status, workspace.id])

  useEffect(() => {
    void loadNotifications()
  }, [loadNotifications])

  const summary = useMemo(() => ({
    total: items.length,
    failed: items.filter((item) => item.status === 'failed').length,
    pending: items.filter((item) => item.status === 'pending').length,
    sent: items.filter((item) => item.status === 'sent').length,
  }), [items])

  return (
    <div className="notifications page-stack">
      <section className="notifications-hero">
        <div>
          <span className="section-kicker">NOTIFICATION OUTBOX</span>
          <h2>通知运维</h2>
          <p>按状态、渠道和失败码定位当前 Workspace 的通知记录，先把事实看清楚，再决定是否恢复或接入真实渠道。</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void loadNotifications()}>
          <RefreshCw size={15} />刷新
        </button>
      </section>

      <section className="notification-summary-grid" aria-label="通知摘要">
        <SummaryCard label="通知总数" value={summary.total} icon={<Bell size={17} />} />
        <SummaryCard label="失败通知" value={summary.failed} icon={<AlertTriangle size={17} />} tone="danger" />
        <SummaryCard label="待发送" value={summary.pending} icon={<Clock3 size={17} />} tone="warning" />
        <SummaryCard label="已发送" value={summary.sent} icon={<CheckCircle2 size={17} />} />
      </section>

      <section className="panel notification-ops-panel">
        <div className="panel-header notification-ops-header">
          <div>
            <span className="section-kicker">FILTERS</span>
            <h3>Outbox 查询</h3>
          </div>
          <Filter size={18} />
        </div>

        <div className="notification-filter-bar">
          <label>
            <span>状态</span>
            <select aria-label="状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}>
              {statusOptions.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>渠道</span>
            <select aria-label="渠道筛选" value={channel} onChange={(event) => setChannel(event.target.value)}>
              {channelOptions.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>失败码</span>
            <select aria-label="失败码筛选" value={errorCode} onChange={(event) => setErrorCode(event.target.value)}>
              {errorCodeOptions.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        {isLoading && <div className="table-state">正在加载通知 Outbox...</div>}
        {error && <div className="table-state error" role="alert">{error}</div>}
        {!isLoading && !error && items.length === 0 && (
          <div className="notification-empty">
            <Bell size={22} />
            <strong>当前筛选下暂无通知</strong>
            <span>调整状态、渠道或失败码筛选后再查看。</span>
          </div>
        )}
        {!isLoading && !error && items.length > 0 && (
          <div className="notification-list" aria-label="通知 Outbox 列表">
            {items.map((item) => (
              <article className={`notification-row ${item.status}`} key={item.id}>
                <div className="notification-row-main">
                  <div>
                    <strong>{item.id}</strong>
                    <span>{item.eventType} / {messageText(item)}</span>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <div className="notification-row-grid">
                  <span><em>接收人</em>{item.recipientType} / {item.recipientId}</span>
                  <span><em>渠道</em>{notificationChannel(item)}</span>
                  <span><em>失败码</em>{notificationErrorCode(item)}</span>
                  <span><em>创建时间</em>{formatTime(item.createdAt)}</span>
                </div>
                <p>{notificationError(item)}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone?: 'neutral' | 'warning' | 'danger'
}) {
  return (
    <article className={`notification-summary-card ${tone}`}>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </article>
  )
}
