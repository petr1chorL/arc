import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  disableMember,
  enableMember,
  inviteMember,
  listMembers,
  resendInvitation,
  revokeInvitation,
  updateMemberRole,
} from './members'

describe('Members API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls member administration endpoints with workspace scoped paths', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { userId: 'user-1', email: 'builder@example.com', displayName: 'Builder' },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        invitationId: 'invite-1',
        email: 'new@example.com',
        role: 'viewer',
        expiresAt: '2026-06-29T09:00:00Z',
        activationUrl: 'http://testserver/activate/token-1',
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        invitationId: 'invite-1',
        email: 'new@example.com',
        role: 'viewer',
        expiresAt: '2026-06-29T09:00:00Z',
        activationUrl: 'http://testserver/activate/token-2',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 'user-1',
        email: 'builder@example.com',
        displayName: 'Builder',
        role: 'operator',
        userStatus: 'active',
        membershipStatus: 'active',
        reviewer: null,
        lastLoginAt: null,
        invitationId: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 'user-1',
        email: 'builder@example.com',
        displayName: 'Builder',
        role: 'operator',
        userStatus: 'active',
        membershipStatus: 'disabled',
        reviewer: null,
        lastLoginAt: null,
        invitationId: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 'user-1',
        email: 'builder@example.com',
        displayName: 'Builder',
        role: 'operator',
        userStatus: 'active',
        membershipStatus: 'active',
        reviewer: null,
        lastLoginAt: null,
        invitationId: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listMembers('workspace-1')).resolves.toHaveLength(1)
    await expect(inviteMember('workspace-1', { email: 'new@example.com', role: 'viewer' })).resolves.toMatchObject({
      invitationId: 'invite-1',
    })
    await expect(resendInvitation('workspace-1', 'invite-1')).resolves.toMatchObject({
      activationUrl: 'http://testserver/activate/token-2',
    })
    await expect(revokeInvitation('workspace-1', 'invite-1')).resolves.toBeUndefined()
    await expect(updateMemberRole('workspace-1', 'user-1', 'operator')).resolves.toMatchObject({
      role: 'operator',
    })
    await expect(disableMember('workspace-1', 'user-1')).resolves.toMatchObject({
      membershipStatus: 'disabled',
    })
    await expect(enableMember('workspace-1', 'user-1')).resolves.toMatchObject({
      membershipStatus: 'active',
    })
  })
})
