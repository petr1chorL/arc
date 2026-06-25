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
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { listHumanTasks } from '../api/humanTasks'

const navigation = [
  { to: '/', label: '运营总览', icon: Gauge },
  { to: '/workflows', label: '工作流编排', icon: Network },
  { to: '/agents', label: 'Agent 资产', icon: Bot },
  { to: '/evaluations', label: '评估中心', icon: ClipboardCheck },
  { to: '/runs', label: '运行中心', icon: Activity },
  { to: '/reviews', label: '人工审核', icon: Blocks },
]

const titles: Record<string, { title: string; eyebrow: string }> = {
  '/': { title: '运营总览', eyebrow: 'CONTROL CENTER' },
  '/workflows': { title: '工作流编排', eyebrow: 'ORCHESTRATION' },
  '/agents': { title: 'Agent 资产', eyebrow: 'AGENT REGISTRY' },
  '/evaluations': { title: '评估中心', eyebrow: 'EVALUATION OPS' },
  '/runs': { title: '运行中心', eyebrow: 'RUNTIME' },
  '/reviews': { title: '人工审核', eyebrow: 'HUMAN IN THE LOOP' },
}

export function Layout() {
  const location = useLocation()
  const [pendingReviewCount, setPendingReviewCount] = useState(0)
  const page = location.pathname.startsWith('/agents/')
    ? titles['/agents']
    : titles[location.pathname] ?? titles['/']

  useEffect(() => {
    function refreshPendingReviewCount() {
      void listHumanTasks()
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
  }, [location.pathname])

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
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              title={label}
              aria-label={label}
              className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {to === '/reviews' && pendingReviewCount > 0 && <em>{pendingReviewCount}</em>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-link" title="平台设置" aria-label="平台设置"><Settings size={17} /><span>平台设置</span></button>
          <button className="sidebar-link" title="帮助中心" aria-label="帮助中心"><CircleHelp size={17} /><span>帮助中心</span></button>
          <div className="workspace-switcher">
            <div className="avatar">AK</div>
            <div><strong>安克创新</strong><span>AI 能力中心</span></div>
            <ChevronDown size={15} />
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
