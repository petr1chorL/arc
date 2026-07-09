import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { getSession, login as loginRequest, logout as logoutRequest } from '../api/auth'
import { listWorkspaces } from '../api/workspaces'
import type { AuthUser, WorkspaceSummary } from '../types'
import { ApiError } from '../api/http'
import { getPreferredWorkspace } from './authNavigation'
import { AuthContext, type AuthContextValue, type AuthStatus } from './authContext'

function decorateWorkspaces(
  workspaces: WorkspaceSummary[],
  user: AuthUser,
): WorkspaceSummary[] {
  return workspaces.map((workspace) => ({
    ...workspace,
    isOrganizationAdmin: workspace.isOrganizationAdmin ?? user.isOrganizationAdmin,
  }))
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
    return {
      user: session.user,
      workspaces: nextWorkspaces,
      preferredWorkspace: getPreferredWorkspace(session.user, nextWorkspaces),
    }
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
