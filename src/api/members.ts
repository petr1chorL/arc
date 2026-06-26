import type { InvitationLink, WorkspaceMember, WorkspaceRole } from '../types'
import { apiFetch, readJson } from './http'

function workspacePath(workspaceId: string, path: string) {
  return `/api/workspaces/${workspaceId}${path}`
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  return readJson<WorkspaceMember[]>(await apiFetch(workspacePath(workspaceId, '/members')))
}

export async function inviteMember(
  workspaceId: string,
  input: { email: string; role: WorkspaceRole },
): Promise<InvitationLink> {
  return readJson<InvitationLink>(await apiFetch(workspacePath(workspaceId, '/invitations'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function resendInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<InvitationLink> {
  return readJson<InvitationLink>(await apiFetch(
    workspacePath(workspaceId, `/invitations/${invitationId}/resend`),
    { method: 'POST' },
  ))
}

export async function recordInvitationLinkCopy(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  const response = await apiFetch(workspacePath(workspaceId, `/invitations/${invitationId}/copy`), {
    method: 'POST',
  })
  if (!response.ok) {
    await readJson(response)
  }
}

export async function revokeInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  const response = await apiFetch(workspacePath(workspaceId, `/invitations/${invitationId}/revoke`), {
    method: 'POST',
  })
  if (!response.ok) {
    await readJson(response)
  }
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<WorkspaceMember> {
  return readJson<WorkspaceMember>(await apiFetch(workspacePath(workspaceId, `/members/${userId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  }))
}

export async function disableMember(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMember> {
  return readJson<WorkspaceMember>(await apiFetch(
    workspacePath(workspaceId, `/members/${userId}/disable`),
    { method: 'POST' },
  ))
}

export async function enableMember(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMember> {
  return readJson<WorkspaceMember>(await apiFetch(
    workspacePath(workspaceId, `/members/${userId}/enable`),
    { method: 'POST' },
  ))
}

export async function disableUser(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMember> {
  return readJson<WorkspaceMember>(await apiFetch(
    workspacePath(workspaceId, `/members/${userId}/user/disable`),
    { method: 'POST' },
  ))
}

export async function enableUser(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMember> {
  return readJson<WorkspaceMember>(await apiFetch(
    workspacePath(workspaceId, `/members/${userId}/user/enable`),
    { method: 'POST' },
  ))
}
