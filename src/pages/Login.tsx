import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/authContext'
import { getPreferredWorkspace, resolveAuthRedirectPath } from '../auth/authNavigation'

export function Login() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fromPathname = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname

  const preferredWorkspace = getPreferredWorkspace(auth.user, auth.workspaces)

  if (auth.status === 'authenticated' && preferredWorkspace) {
    return (
      <Navigate
        to={resolveAuthRedirectPath(preferredWorkspace, fromPathname) ?? `/w/${preferredWorkspace.slug}`}
        replace
      />
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setError('')
    try {
      const { preferredWorkspace: nextWorkspace } = await auth.login(email.trim(), password)
      const redirectPath = resolveAuthRedirectPath(nextWorkspace, fromPathname)
      if (redirectPath) {
        navigate(redirectPath, { replace: true })
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '登录失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="auth-copy">
          <div className="auth-mark" aria-label="ARC.ONE">
            <span>ARC</span>
          </div>
          <p className="section-kicker">IDENTITY & ACCESS</p>
          <h1>登录 ARC.ONE</h1>
          <span>使用 Workspace 成员身份进入当前协作空间。</span>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-status-pill">
            <span />
            Workspace protected
          </div>
          <label className="form-field">
            <span>邮箱</span>
            <input
              autoComplete="email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>密码</span>
            <input
              autoComplete="current-password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <div className="inline-feedback error" role="alert">{error}</div>}
          <button className="button primary full" disabled={isSubmitting} type="submit">
            {isSubmitting ? '登录中...' : '登录'}
          </button>
          <small>Session 与 CSRF 校验已启用</small>
        </form>
      </section>
    </div>
  )
}
