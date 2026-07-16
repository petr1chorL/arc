import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import {
  activateInvitation,
  previewInvitation,
} from '../api/auth'
import type { InvitationPreview } from '../types'

export function ActivateInvitation() {
  const { token = '' } = useParams()
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    void previewInvitation(token)
      .then(setPreview)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : '邀请加载失败')
      })
  }, [token])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedDisplayName = displayName.trim()
    setMessage('')
    setError('')
    if (!normalizedDisplayName) {
      setError('请输入显示名称')
      return
    }
    if (password.length < 12) {
      setError('密码至少需要 12 个字符')
      return
    }
    setIsSubmitting(true)
    try {
      await activateInvitation(token, { displayName: normalizedDisplayName, password })
      setMessage('账号已激活，请返回登录。')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '邀请激活失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="auth-copy">
          <p className="section-kicker">INVITATION</p>
          <h1>激活邀请</h1>
          <span>
            {preview?.workspaceName
              ? `即将加入 ${preview.workspaceName}`
              : '完成账号激活后即可进入受邀 Workspace。'}
          </span>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>显示名称</span>
            <input required maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label className="form-field">
            <span>密码</span>
            <input
              aria-label="密码"
              aria-describedby="activation-password-hint"
              autoComplete="new-password"
              type="password"
              required
              minLength={12}
              maxLength={1024}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <small id="activation-password-hint">至少 12 个字符</small>
          </label>
          {message && <div className="inline-feedback" role="status">{message}</div>}
          {error && <div className="inline-feedback error" role="alert">{error}</div>}
          <button className="button primary full" disabled={isSubmitting} type="submit">
            {isSubmitting ? '激活中…' : '激活账号'}
          </button>
        </form>
      </section>
    </div>
  )
}
