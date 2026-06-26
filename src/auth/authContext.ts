import { createContext, useContext } from 'react'
import type { AuthUser, WorkspaceSummary } from '../types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface LoginResult {
  user: AuthUser
  workspaces: WorkspaceSummary[]
  preferredWorkspace: WorkspaceSummary | null
}

export interface AuthContextValue {
  user: AuthUser | null
  workspaces: WorkspaceSummary[]
  status: AuthStatus
  login: (email: string, password: string) => Promise<LoginResult>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth 必须在 AuthProvider 内使用')
  }
  return value
}
