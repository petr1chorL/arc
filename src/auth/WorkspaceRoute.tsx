import { Outlet, useParams } from 'react-router-dom'
import { useAuth } from './authContext'
import { WorkspaceContext } from './workspaceContextState'

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

  const value = {
    workspace,
    workspaceApiPath(path: string) {
      const normalized = path.startsWith('/') ? path : `/${path}`
      return `/api/workspaces/${workspace.id}${normalized}`
    },
    workspacePath(path = '') {
      const normalized = path ? (path.startsWith('/') ? path : `/${path}`) : ''
      return `/w/${workspace.slug}${normalized}`
    },
  }

  return (
    <WorkspaceContext.Provider value={value}>
      <Outlet />
    </WorkspaceContext.Provider>
  )
}
