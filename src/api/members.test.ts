import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  disableMember,
  disableUser,
  enableMember,
  enableUser,
  getWorkspacePermissionMatrix,
  inviteMember,
  listMembers,
  recordInvitationLinkCopy,
  resendInvitation,
  revokeInvitation,
  revokeReviewerQualification,
  saveReviewerQualification,
  updateMemberRole,
} from './members'

describe('Members API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls member administration endpoints with workspace scoped paths', async () => {
    const member = {
        userId: 'user-1',
        email: 'builder@example.com',
        displayName: 'Builder',
        role: 'operator',
        userStatus: 'active',
        membershipStatus: 'active',
        reviewer: null,
        lastLoginAt: null,
        invitationId: null,
      } as const
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/workspaces/workspace-1/members' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([
          { userId: 'user-1', email: 'builder@example.com', displayName: 'Builder' },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url === '/api/workspaces/workspace-1/permissions/matrix' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify({
          roles: ['viewer', 'operator', 'builder', 'workspace_admin'],
          capabilities: [{ key: 'asset.read', label: '读取资产', requiredRole: 'viewer' }],
          matrix: [{ role: 'viewer', capabilities: { 'asset.read': true } }],
          reviewerQualificationNote: 'Reviewer 是单独业务资格',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url === '/api/workspaces/workspace-1/invitations' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({
          invitationId: 'invite-1',
          email: 'new@example.com',
          role: 'viewer',
          expiresAt: '2026-06-29T09:00:00Z',
          activationUrl: 'http://testserver/activate/token-1',
        }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url === '/api/workspaces/workspace-1/invitations/invite-1/resend') {
        return Promise.resolve(new Response(JSON.stringify({
          invitationId: 'invite-1',
          email: 'new@example.com',
          role: 'viewer',
          expiresAt: '2026-06-29T09:00:00Z',
          activationUrl: 'http://testserver/activate/token-2',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (
        url === '/api/workspaces/workspace-1/invitations/invite-1/copy'
        || url === '/api/workspaces/workspace-1/invitations/invite-1/revoke'
      ) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/workspaces/workspace-1/members/user-1' && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(member), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url === '/api/workspaces/workspace-1/members/user-1/reviewer' && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({
          ...member,
          reviewer: { role: '内容审核人', isExpert: true, isActive: true },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url === '/api/workspaces/workspace-1/members/user-1/reviewer' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(JSON.stringify({
          ...member,
          reviewer: { role: '内容审核人', isExpert: false, isActive: false },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url === '/api/workspaces/workspace-1/members/user-1/disable') {
        return Promise.resolve(new Response(JSON.stringify({ ...member, membershipStatus: 'disabled' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url === '/api/workspaces/workspace-1/members/user-1/enable') {
        return Promise.resolve(new Response(JSON.stringify(member), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url === '/api/workspaces/workspace-1/members/user-1/user/disable') {
        return Promise.resolve(new Response(JSON.stringify({ ...member, userStatus: 'disabled' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url === '/api/workspaces/workspace-1/members/user-1/user/enable') {
        return Promise.resolve(new Response(JSON.stringify(member), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.reject(new Error(`Unhandled request: ${String(url)}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listMembers('workspace-1')).resolves.toHaveLength(1)
    await expect(getWorkspacePermissionMatrix('workspace-1')).resolves.toMatchObject({
      roles: ['viewer', 'operator', 'builder', 'workspace_admin'],
      reviewerQualificationNote: 'Reviewer 是单独业务资格',
    })
    await expect(inviteMember('workspace-1', { email: 'new@example.com', role: 'viewer' })).resolves.toMatchObject({
      invitationId: 'invite-1',
    })
    await expect(resendInvitation('workspace-1', 'invite-1')).resolves.toMatchObject({
      activationUrl: 'http://testserver/activate/token-2',
    })
    await expect(recordInvitationLinkCopy('workspace-1', 'invite-1')).resolves.toBeUndefined()
    await expect(revokeInvitation('workspace-1', 'invite-1')).resolves.toBeUndefined()
    await expect(updateMemberRole('workspace-1', 'user-1', 'operator')).resolves.toMatchObject({
      role: 'operator',
    })
    await expect(saveReviewerQualification('workspace-1', 'user-1', {
      role: '内容审核人',
      isExpert: true,
    })).resolves.toMatchObject({
      reviewer: { role: '内容审核人', isExpert: true, isActive: true },
    })
    await expect(revokeReviewerQualification('workspace-1', 'user-1')).resolves.toMatchObject({
      reviewer: { isActive: false },
    })
    await expect(disableMember('workspace-1', 'user-1')).resolves.toMatchObject({
      membershipStatus: 'disabled',
    })
    await expect(enableMember('workspace-1', 'user-1')).resolves.toMatchObject({
      membershipStatus: 'active',
    })
    await expect(disableUser('workspace-1', 'user-1')).resolves.toMatchObject({
      userStatus: 'disabled',
    })
    await expect(enableUser('workspace-1', 'user-1')).resolves.toMatchObject({
      userStatus: 'active',
    })
    const reviewerSaveCall = fetchMock.mock.calls.find(([input, init]) => (
      input === '/api/workspaces/workspace-1/members/user-1/reviewer' && init?.method === 'PUT'
    ))
    expect(JSON.parse(reviewerSaveCall?.[1]?.body as string)).toEqual({
      role: '内容审核人',
      isExpert: true,
    })
  })
})
