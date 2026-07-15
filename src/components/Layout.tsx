import {
  Activity,
  Blocks,
  Bot,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Gauge,
  KeyRound,
  Network,
  Search,
  Settings,
  Wrench,
  UsersRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { listHumanTasks } from '../api/humanTasks'
import { useAuth } from '../auth/authContext'
import { CapabilityGuard } from '../auth/CapabilityGuard'
import { workspaceHasCapability } from '../auth/workspaceCapabilities'
import { useWorkspace } from '../auth/workspaceContextState'

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
  '/quality-operations': { title: '质量运营', eyebrow: 'QUALITY OPERATIONS' },
  '/runs': { title: '运行中心', eyebrow: 'RUNTIME' },
  '/artifacts': { title: '产出物', eyebrow: 'ARTIFACT CATALOG' },
  '/observability': { title: '运行观测', eyebrow: 'OBSERVABILITY' },
  '/reviews': { title: '人工审核', eyebrow: 'HUMAN IN THE LOOP' },
  '/settings/asset-library': { title: 'Tool / Skill 资产库', eyebrow: 'TOOL REGISTRY' },
  '/settings/members': { title: '成员与权限', eyebrow: 'ACCESS CONTROL' },
  '/settings/model-providers': { title: '模型资产', eyebrow: 'MODEL ACCESS' },
}

const completedHumanTaskStatuses = ['已通过', '修改后通过', '已驳回', '已退回']

export function Layout() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { workspace, workspacePath } = useWorkspace()
  const [pendingReviewCount, setPendingReviewCount] = useState(0)
  const relativePath = location.pathname.replace(`/w/${workspace.slug}`, '')
  const pageKey = relativePath.startsWith('/agents/')
    ? '/agents'
    : relativePath.startsWith('/workflows/')
    ? '/workflows'
    : relativePath || ''
  const page = titles[pageKey] ?? titles['']

  useEffect(() => {
    function refreshPendingReviewCount() {
      void listHumanTasks(workspace.id)
        .then((tasks) => setPendingReviewCount(
          tasks.filter((task) => !completedHumanTaskStatuses.includes(task.status)).length,
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
                className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
                {path === 'reviews' && pendingReviewCount > 0 && <em>{pendingReviewCount}</em>}
              </NavLink>
            )
          })}
          <CapabilityGuard capability="member.manage">
            <NavLink
              to={workspacePath('settings/model-providers')}
              title="模型资产"
              aria-label="模型资产"
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              <KeyRound size={18} strokeWidth={1.8} />
              <span>模型资产</span>
            </NavLink>
          </CapabilityGuard>
          <CapabilityGuard capability="agent.write">
            <NavLink
              to={workspacePath('settings/asset-library')}
              title="Tool / Skill"
              aria-label="Tool / Skill"
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              <Wrench size={18} strokeWidth={1.8} />
              <span>Tool / Skill</span>
            </NavLink>
          </CapabilityGuard>
          <CapabilityGuard capability="member.manage">
            <NavLink
              to={workspacePath('settings/members')}
              title="成员与权限"
              aria-label="成员与权限"
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              <UsersRound size={18} strokeWidth={1.8} />
              <span>成员与权限</span>
            </NavLink>
          </CapabilityGuard>
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-link" title="平台设置" aria-label="平台设置">
            <Settings size={17} />
            <span>平台设置</span>
          </button>
          <button className="sidebar-link" title="帮助中心" aria-label="帮助中心">
            <CircleHelp size={17} />
            <span>帮助中心</span>
          </button>
          <div className="workspace-switcher">
            <div className="avatar">{workspace.name.slice(0, 2).toUpperCase()}</div>
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
              <kbd>Ctrl K</kbd>
            </label>
            <div className="topbar-user">
              <div className="topbar-user-main">
                <strong>{auth.user?.displayName ?? '访客'}</strong>
                <span>{auth.user?.email ?? ''}</span>
              </div>
              <small className="topbar-user-role">
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
