import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/authContext'
import { getPreferredWorkspace } from './auth/authNavigation'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { WorkspaceRoute } from './auth/WorkspaceRoute'
import { Layout } from './components/Layout'
import { Agents } from './pages/Agents'
import { AgentDetail } from './pages/AgentDetail'
import { ActivateInvitation } from './pages/ActivateInvitation'
import { Dashboard } from './pages/Dashboard'
import { Evaluations } from './pages/Evaluations'
import { Login } from './pages/Login'
import { Members } from './pages/Members'
import { ModelProviders } from './pages/ModelProviders'
import { Observability } from './pages/Observability'
import { Reviews } from './pages/Reviews'
import { Runs } from './pages/Runs'
import { Workflows } from './pages/Workflows'

function WorkspaceLandingRedirect() {
  const auth = useAuth()
  const workspace = getPreferredWorkspace(auth.user, auth.workspaces)

  if (auth.status === 'loading') {
    return <div className="panel table-state">正在恢复工作区…</div>
  }
  if (auth.status === 'anonymous') {
    return <Navigate to="/login" replace />
  }
  if (!workspace) {
    return <div className="panel table-state error">当前账号没有可访问的 Workspace</div>
  }
  return <Navigate to={`/w/${workspace.slug}`} replace />
}

function LegacyWorkspaceRedirect({ suffix }: { suffix?: string }) {
  const auth = useAuth()
  const location = useLocation()
  const workspace = getPreferredWorkspace(auth.user, auth.workspaces)

  if (auth.status === 'loading') {
    return <div className="panel table-state">正在恢复工作区…</div>
  }
  if (auth.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (!workspace) {
    return <div className="panel table-state error">当前账号没有可访问的 Workspace</div>
  }
  const nextSuffix = suffix ?? location.pathname.replace(/^\/+/, '')
  const normalized = nextSuffix ? `/${nextSuffix}` : ''
  return <Navigate to={`/w/${workspace.slug}${normalized}`} replace />
}

function SettingsStub({ title }: { title: string }) {
  return <div className="panel table-state">{title}将在后续任务中补齐。</div>
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/activate/:token" element={<ActivateInvitation />} />
          <Route path="/" element={<WorkspaceLandingRedirect />} />
          <Route path="/workflows" element={<LegacyWorkspaceRedirect suffix="workflows" />} />
          <Route path="/agents" element={<LegacyWorkspaceRedirect suffix="agents" />} />
          <Route path="/agents/:agentId" element={<LegacyWorkspaceRedirect />} />
          <Route path="/evaluations" element={<LegacyWorkspaceRedirect suffix="evaluations" />} />
          <Route path="/runs" element={<LegacyWorkspaceRedirect suffix="runs" />} />
          <Route path="/observability" element={<LegacyWorkspaceRedirect suffix="observability" />} />
          <Route path="/reviews" element={<LegacyWorkspaceRedirect suffix="reviews" />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/w/:workspaceSlug" element={<WorkspaceRoute />}>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="workflows" element={<Workflows />} />
                <Route path="agents" element={<Agents />} />
                <Route path="agents/:agentId" element={<AgentDetail />} />
                <Route path="evaluations" element={<Evaluations />} />
                <Route path="runs" element={<Runs />} />
                <Route path="observability" element={<Observability />} />
                <Route path="reviews" element={<Reviews />} />
                <Route path="settings/members" element={<Members />} />
                <Route path="settings/model-providers" element={<ModelProviders />} />
                <Route path="settings/audit" element={<SettingsStub title="审计日志" />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
