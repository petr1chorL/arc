import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { getSession, login as loginRequest, logout as logoutRequest } from '../api/auth'
import { listWorkspaces } from '../api/workspaces'
import type { AuthUser, WorkspaceSummary } from '../types'
import { ApiError } from '../api/http'

type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  user: AuthUser | null
  workspaces: WorkspaceSummary[]
  status: AuthStatus
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function decorateWorkspaces(
  workspaces: WorkspaceSummary[],
  user: AuthUser,
): WorkspaceSummary[] {
  return workspaces.map((workspace) => ({
    ...workspace,
    isOrganizationAdmin: workspace.isOrganizationAdmin ?? user.isOrganizationAdmin,
  }))
}

export function getPreferredWorkspace(
  user: AuthUser | null,
  workspaces: WorkspaceSummary[],
): WorkspaceSummary | null {
  if (!workspaces.length) return null
  if (user?.lastWorkspaceId) {
    const matched = workspaces.find((workspace) => workspace.id === user.lastWorkspaceId)
    if (matched) return matched
  }
  return workspaces[0] ?? null
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [status, setStatus] = useState<AuthStatus>('loading')

  const setAnonymous = useCallback(() => {
    setUser(null)
    setWorkspaces([])
    setStatus('anonymous')
  }, [])

  const refreshSession = useCallback(async () => {
    setStatus('loading')
    try {
      const session = await getSession()
      const nextWorkspaces = decorateWorkspaces(
        await listWorkspaces(),
        session.user,
      )
      setUser(session.user)
      setWorkspaces(nextWorkspaces)
      setStatus('authenticated')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAnonymous()
        return
      }
      throw error
    }
  }, [setAnonymous])

  const login = useCallback(async (email: string, password: string) => {
    const session = await loginRequest(email, password)
    const nextWorkspaces = decorateWorkspaces(
      await listWorkspaces(),
      session.user,
    )
    setUser(session.user)
    setWorkspaces(nextWorkspaces)
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    } finally {
      setAnonymous()
    }
  }, [setAnonymous])

  useEffect(() => {
    void refreshSession().catch(() => {
      setAnonymous()
    })
  }, [refreshSession, setAnonymous])

  useEffect(() => {
    function handleSessionExpired() {
      setAnonymous()
    }
    window.addEventListener('auth-session-expired', handleSessionExpired)
    return () => {
      window.removeEventListener('auth-session-expired', handleSessionExpired)
    }
  }, [setAnonymous])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    workspaces,
    status,
    login,
    logout,
    refreshSession,
  }), [login, logout, refreshSession, status, user, workspaces])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth 必须在 AuthProvider 内使用')
  }
  return value
}
