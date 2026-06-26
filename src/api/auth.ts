import type { AuthSession, InvitationPreview } from '../types'
import { apiFetch, readJson } from './http'

export interface ActivateInvitationInput {
  displayName: string
  password: string
}

export async function login(email: string, password: string): Promise<AuthSession> {
  return readJson<AuthSession>(await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }))
}

export async function logout(): Promise<void> {
  const response = await apiFetch('/api/auth/logout', { method: 'POST' })
  if (!response.ok) {
    await readJson(response)
  }
}

export async function getSession(): Promise<AuthSession> {
  return readJson<AuthSession>(await apiFetch('/api/auth/session'))
}

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  return readJson<InvitationPreview>(await apiFetch(`/api/invitations/${token}`))
}

export async function activateInvitation(
  token: string,
  input: ActivateInvitationInput,
): Promise<void> {
  const response = await apiFetch(`/api/invitations/${token}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    await readJson(response)
  }
}
