import {
  Activity,
  Bell,
  Blocks,
  Bot,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Gauge,
  Network,
  Search,
  Settings,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { CapabilityGuard, workspaceHasCapability } from '../auth/CapabilityGuard'
import { useWorkspace } from '../auth/WorkspaceContext'
import { listHumanTasks } from '../api/humanTasks'

const navigation = [
  { path: '', label: '运营总览', icon: Gauge },
  { path: 'workflows', label: '工作流编排', icon: Network },
  { path: 'agents', label: 'Agent 资产', icon: Bot },
  { path: 'evaluations', label: '评估中心', icon: ClipboardCheck },
  { path: 'runs', label: '运行中心', icon: Activity },
  { path: 'reviews', label: '人工审核', icon: Blocks },
]

const titles: Record<string, { title: string; eyebrow: string }> = {
  '': { title: '运营总览', eyebrow: 'CONTROL CENTER' },
  '/workflows': { title: '工作流编排', eyebrow: 'ORCHESTRATION' },
  '/agents': { title: 'Agent 资产', eyebrow: 'AGENT REGISTRY' },
  '/evaluations': { title: '评估中心', eyebrow: 'EVALUATION OPS' },
  '/runs': { title: '运行中心', eyebrow: 'RUNTIME' },
  '/reviews': { title: '人工审核', eyebrow: 'HUMAN IN THE LOOP' },
  '/settings/members': { title: '成员与权限', eyebrow: 'ACCESS CONTROL' },
  '/settings/audit': { title: '审计日志', eyebrow: 'AUDIT TRAIL' },
}

export function Layout() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { workspace, workspacePath } = useWorkspace()
  const [pendingReviewCount, setPendingReviewCount] = useState(0)
  const relativePath = location.pathname.replace(`/w/${workspace.slug}`, '')
  const pageKey = relativePath.startsWith('/agents/')
    ? '/agents'
    : relativePath || ''
  const page = titles[pageKey] ?? titles['']

  useEffect(() => {
    function refreshPendingReviewCount() {
      void listHumanTasks(workspace.id)
        .then((tasks) => setPendingReviewCount(
          tasks.filter((task) => ![
            '已通过',
            '修改后通过',
            '已驳回',
            '已退回',
          ].includes(task.status)).length,
        ))
        .catch(() => setPendingReviewCount(0))
    }

    refreshPendingReviewCount()
    window.addEventListener('human-tasks-updated', refreshPendingReviewCount)
    return () => {
      window.removeEventListener('human-tasks-updated', refreshPendingReviewCount)
    }
  }, [location.pathname, workspace.id])

  const currentSuffix = relativePath.replace(/^\/+/, '')

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Network size={19} /></div>
          <div>
            <strong>ARC.ONE</strong>
            <span>Agentic OS</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          <span className="nav-section-label">工作空间</span>
          {navigation.map(({ path, label, icon: Icon }) => {
            const to = workspacePath(path)
            return (
            <NavLink
              key={path || 'index'}
              to={to}
              end={!path}
              title={label}
              aria-label={label}
              className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {path === 'reviews' && pendingReviewCount > 0 && <em>{pendingReviewCount}</em>}
            </NavLink>
            )
          })}
          <CapabilityGuard capability="member.manage">
            <NavLink
              to={workspacePath('settings/members')}
              title="成员与权限"
              aria-label="成员与权限"
              className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}
            >
              <Settings size={18} strokeWidth={1.8} />
              <span>成员与权限</span>
            </NavLink>
          </CapabilityGuard>
          <CapabilityGuard capability="audit.read">
            <NavLink
              to={workspacePath('settings/audit')}
              title="审计日志"
              aria-label="审计日志"
              className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}
            >
              <ClipboardCheck size={18} strokeWidth={1.8} />
              <span>审计日志</span>
            </NavLink>
          </CapabilityGuard>
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-link" title="平台设置" aria-label="平台设置"><Settings size={17} /><span>平台设置</span></button>
          <button className="sidebar-link" title="帮助中心" aria-label="帮助中心"><CircleHelp size={17} /><span>帮助中心</span></button>
          <div className="workspace-switcher">
            <div className="avatar">{(auth.user?.displayName ?? 'A').slice(0, 2).toUpperCase()}</div>
            <div className="workspace-switcher-copy">
              <strong>{auth.user?.displayName ?? '未登录用户'}</strong>
              <span>{workspace.name}</span>
            </div>
            <label className="workspace-switcher-select">
              <span className="sr-only">切换工作空间</span>
              <select
                aria-label="切换工作空间"
                value={workspace.id}
                onChange={(event) => {
                  const nextWorkspace = auth.workspaces.find((item) => item.id === event.target.value)
                  if (!nextWorkspace) return
                  navigate(`/w/${nextWorkspace.slug}${currentSuffix ? `/${currentSuffix}` : ''}`)
                }}
              >
                {auth.workspaces.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="page-identity">
            <span>{page.eyebrow}</span>
            <h1>{page.title}</h1>
          </div>
          <div className="topbar-actions">
            <label className="global-search">
              <Search size={16} />
              <input aria-label="全局搜索" placeholder="搜索工作流、Agent、运行实例" />
              <kbd>⌘ K</kbd>
            </label>
            <button className="icon-button" title="通知"><Bell size={18} /><i /></button>
            <div className="topbar-user">
              <div>
                <strong>{auth.user?.displayName ?? '访客'}</strong>
                <span>{auth.user?.email ?? ''}</span>
              </div>
              <small>
                {workspaceHasCapability(workspace, auth.user?.isOrganizationAdmin, 'member.manage')
                  ? 'Workspace 管理员'
                  : '成员'}
              </small>
              <button className="button ghost compact" onClick={() => void auth.logout()}>退出</button>
            </div>
            <div className="environment"><span />生产环境</div>
          </div>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
