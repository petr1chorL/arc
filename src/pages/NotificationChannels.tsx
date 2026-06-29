import { Bell, Plus, Power, RadioTower } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  createNotificationChannel,
  disableNotificationChannel,
  listNotificationChannels,
  type CreateNotificationChannelInput,
} from '../api/notificationChannels'
import { useWorkspace } from '../auth/workspaceContextState'
import type { NotificationChannel, NotificationChannelType } from '../types'

const initialForm = {
  name: '',
  channelType: 'webhook' as NotificationChannelType,
  secretRef: '',
  configJson: '{\n  "urlRef": "WEBHOOK_URL"\n}',
}

const channelTypeLabels: Record<NotificationChannelType, string> = {
  in_app: '站内通知',
  webhook: 'Webhook',
  email: '邮件',
  feishu: '飞书',
}

function parseConfig(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('配置 JSON 必须是 JSON 对象')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error && error.message === '配置 JSON 必须是 JSON 对象') {
      throw error
    }
    throw new Error('配置 JSON 必须是合法 JSON')
  }
}

function compactJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2)
}

export function NotificationChannels() {
  const { workspace } = useWorkspace()
  const [channels, setChannels] = useState<NotificationChannel[]>([])
  const [form, setForm] = useState(initialForm)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    void listNotificationChannels(workspace.id)
      .then(setChannels)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '通知渠道加载失败'))
  }, [workspace.id])

  function updateForm<TField extends keyof typeof initialForm>(field: TField, value: (typeof initialForm)[TField]) {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
    setFeedback('')
  }

  async function createChannel() {
    setIsBusy(true)
    setError('')
    try {
      const input: CreateNotificationChannelInput = {
        name: form.name.trim(),
        channelType: form.channelType,
        secretRef: form.secretRef.trim(),
        config: parseConfig(form.configJson),
      }
      const created = await createNotificationChannel(workspace.id, input)
      setChannels((current) => [created, ...current])
      setForm(initialForm)
      setFeedback('通知渠道已创建')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '通知渠道创建失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function disableChannel(channel: NotificationChannel) {
    setIsBusy(true)
    setError('')
    try {
      const disabled = await disableNotificationChannel(workspace.id, channel.id)
      setChannels((current) => current.map((item) => item.id === disabled.id ? disabled : item))
      setFeedback('通知渠道已停用')
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : '通知渠道停用失败')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="page-stack notification-channel-page">
      <section className="panel asset-library-intro">
        <div>
          <span className="section-kicker">CHANNEL GOVERNANCE</span>
          <h2>通知渠道</h2>
          <p>维护当前 Workspace 可用的通知渠道资产。本页只保存非密钥配置和 Secret Ref 标签，不发送真实外部通知。</p>
        </div>
        <div className="draft-indicator"><Bell size={16} />{channels.length}</div>
      </section>

      <section className="panel asset-library-form-panel">
        <div className="section-heading">
          <div><span className="section-kicker">配置入口</span><h3>新增通知渠道</h3></div>
        </div>
        <div className="form-grid compact-grid">
          <label>
            <span>渠道名称</span>
            <input
              aria-label="渠道名称"
              value={form.name}
              onChange={(event) => updateForm('name', event.target.value)}
              placeholder="例如：飞书提醒"
            />
          </label>
          <label>
            <span>渠道类型</span>
            <select
              aria-label="渠道类型"
              value={form.channelType}
              onChange={(event) => updateForm('channelType', event.target.value as NotificationChannelType)}
            >
              {Object.entries(channelTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Secret Ref</span>
            <input
              aria-label="Secret Ref"
              value={form.secretRef}
              onChange={(event) => updateForm('secretRef', event.target.value)}
              placeholder="例如：FEISHU_BOT_SECRET"
            />
          </label>
          <label className="full-span">
            <span>配置 JSON</span>
            <textarea
              aria-label="配置 JSON"
              value={form.configJson}
              onChange={(event) => updateForm('configJson', event.target.value)}
              rows={5}
            />
          </label>
        </div>
        <button className="button primary" disabled={isBusy} onClick={() => void createChannel()}>
          <Plus size={15} />创建通知渠道
        </button>
      </section>

      {(feedback || error) && (
        <div className={`inline-feedback ${error ? 'error' : ''}`}>
          {error || feedback}
        </div>
      )}

      <section className="panel">
        <div className="section-heading">
          <div><span className="section-kicker">资产列表</span><h3>渠道资产</h3></div>
          <span className="draft-indicator"><i />{channels.length}</span>
        </div>
        {channels.length === 0 && <div className="table-state">暂无通知渠道。</div>}
        <div className="asset-library-list notification-channel-list">
          {channels.map((channel) => (
            <article className="asset-library-card notification-channel-card" key={channel.id}>
              <div className="asset-library-card-head">
                <div className="asset-icon"><RadioTower size={17} /></div>
                <div>
                  <strong>{channel.name}</strong>
                  <span>{channel.id}</span>
                </div>
                <span className={`status-pill ${channel.status === 'active' ? 'success' : 'muted'}`}>
                  {channel.status}
                </span>
              </div>
              <dl className="notification-channel-meta">
                <div><dt>类型</dt><dd>{channelTypeLabels[channel.channelType]}</dd></div>
                <div><dt>Secret Ref</dt><dd>{channel.secretRef || '未配置'}</dd></div>
                <div><dt>更新</dt><dd>{new Date(channel.updatedAt).toLocaleString()}</dd></div>
              </dl>
              <pre className="json-preview">{compactJson(channel.config)}</pre>
              {channel.status === 'active' && (
                <button
                  className="button danger compact"
                  disabled={isBusy}
                  onClick={() => void disableChannel(channel)}
                  aria-label={`停用 ${channel.name}`}
                >
                  <Power size={14} />停用
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
