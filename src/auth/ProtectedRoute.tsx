import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './authContext'

export function ProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'loading') {
    return <div className="panel table-state">正在恢复登录状态…</div>
  }
  if (auth.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <Outlet />
}
