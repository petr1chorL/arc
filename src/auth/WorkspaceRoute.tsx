import { Outlet, useParams } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { WorkspaceProvider } from './WorkspaceContext'

export function WorkspaceRoute() {
  const { workspaceSlug = '' } = useParams()
  const { workspaces } = useAuth()
  const workspace = workspaces.find((item) => item.slug === workspaceSlug)

  if (!workspace) {
    return (
      <div className="panel table-state error" role="alert">
        无权访问该 Workspace
      </div>
    )
  }

  return (
    <WorkspaceProvider workspace={workspace}>
      <Outlet />
    </WorkspaceProvider>
  )
}
