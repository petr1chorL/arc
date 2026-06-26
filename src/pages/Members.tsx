import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Copy, MailPlus, RefreshCcw, ShieldCheck, UserCog } from 'lucide-react'
import {
  disableMember,
  disableUser,
  enableMember,
  enableUser,
  inviteMember,
  listMembers,
  recordInvitationLinkCopy,
  resendInvitation,
  revokeInvitation,
  revokeReviewerQualification,
  saveReviewerQualification,
  updateMemberRole,
} from '../api/members'
import { useWorkspace } from '../auth/workspaceContextState'
import type { WorkspaceMember, WorkspaceRole } from '../types'

const roleOptions: Array<{ value: WorkspaceRole; label: string }> = [
  { value: 'viewer', label: 'viewer' },
  { value: 'operator', label: 'operator' },
  { value: 'builder', label: 'builder' },
  { value: 'workspace_admin', label: 'workspace_admin' },
]

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatTimestamp(value: string | null) {
  if (!value) return '从未登录'
  return value.replace('T', ' ').replace('Z', ' UTC')
}

function qualificationLabel(member: WorkspaceMember) {
  if (!member.reviewer) return '未授予'
  if (!member.reviewer.isActive) return '已撤销'
  return member.reviewer.isExpert ? `${member.reviewer.role} · 专家` : member.reviewer.role
}

export function Members() {
  const { workspace } = useWorkspace()
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [draftRoles, setDraftRoles] = useState<Record<string, WorkspaceRole>>({})
  const [draftReviewerRoles, setDraftReviewerRoles] = useState<Record<string, string>>({})
  const [draftReviewerExpertFlags, setDraftReviewerExpertFlags] = useState<Record<string, boolean>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('viewer')
  const [submitError, setSubmitError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [activationUrl, setActivationUrl] = useState('')
  const [activationInvitationId, setActivationInvitationId] = useState('')
  const [busyKey, setBusyKey] = useState('')

  const loadMembers = useCallback(async () => {
    setIsLoading(true)
    setSubmitError('')
    try {
      const nextMembers = await listMembers(workspace.id)
      setMembers(nextMembers)
      setDraftRoles(Object.fromEntries(nextMembers.map((member) => [member.userId, member.role])))
      setDraftReviewerRoles(Object.fromEntries(
        nextMembers.map((member) => [member.userId, member.reviewer?.role ?? '']),
      ))
      setDraftReviewerExpertFlags(Object.fromEntries(
        nextMembers.map((member) => [member.userId, member.reviewer?.isExpert ?? false]),
      ))
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '成员列表加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [workspace.id])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  const activeCount = useMemo(
    () => members.filter((member) => member.membershipStatus === 'active').length,
    [members],
  )

  async function copyActivationLink() {
    if (!activationUrl || !activationInvitationId) return
    setBusyKey('copy')
    setSubmitError('')
    try {
      await navigator.clipboard.writeText(activationUrl)
      await recordInvitationLinkCopy(workspace.id, activationInvitationId)
      setStatusMessage('激活链接已复制。')
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '复制失败，请检查浏览器权限。')
    } finally {
      setBusyKey('')
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = inviteEmail.trim().toLowerCase()
    if (!emailPattern.test(normalizedEmail)) {
      setSubmitError('请输入有效邮箱地址')
      return
    }
    setBusyKey('invite')
    setSubmitError('')
    try {
      const created = await inviteMember(workspace.id, { email: normalizedEmail, role: inviteRole })
      if (created.activationUrl) {
        setActivationUrl(created.activationUrl)
        setActivationInvitationId(created.invitationId)
        setStatusMessage('邀请已创建，激活链接仅显示这一次。')
      } else {
        setActivationUrl('')
        setActivationInvitationId('')
        setStatusMessage(`${created.email} 已加入当前 Workspace。`)
      }
      setInviteEmail('')
      setInviteRole('viewer')
      setIsInviteOpen(false)
      await loadMembers()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '邀请创建失败')
    } finally {
      setBusyKey('')
    }
  }

  async function handleRoleSave(member: WorkspaceMember) {
    const nextRole = draftRoles[member.userId] ?? member.role
    setBusyKey(`role:${member.userId}`)
    setSubmitError('')
    try {
      const updated = await updateMemberRole(workspace.id, member.userId, nextRole)
      setMembers((current) => current.map((item) => item.userId === member.userId ? updated : item))
      setStatusMessage(`${member.email} 角色已更新。`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '角色更新失败')
    } finally {
      setBusyKey('')
    }
  }

  async function handleReviewerSave(member: WorkspaceMember) {
    const nextRole = (draftReviewerRoles[member.userId] ?? member.reviewer?.role ?? '').trim()
    if (!nextRole) {
      setSubmitError('请填写审核资格角色')
      return
    }
    setBusyKey(`reviewer:${member.userId}`)
    setSubmitError('')
    try {
      const updated = await saveReviewerQualification(workspace.id, member.userId, {
        role: nextRole,
        isExpert: draftReviewerExpertFlags[member.userId] ?? false,
      })
      setMembers((current) => current.map((item) => item.userId === member.userId ? updated : item))
      setDraftReviewerRoles((current) => ({ ...current, [member.userId]: updated.reviewer?.role ?? '' }))
      setDraftReviewerExpertFlags((current) => ({ ...current, [member.userId]: updated.reviewer?.isExpert ?? false }))
      setStatusMessage(`${member.email} 审核资格已更新。`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '审核资格更新失败')
    } finally {
      setBusyKey('')
    }
  }

  async function handleReviewerRevoke(member: WorkspaceMember) {
    if (!member.reviewer?.isActive) return
    setBusyKey(`reviewer:${member.userId}`)
    setSubmitError('')
    try {
      const updated = await revokeReviewerQualification(workspace.id, member.userId)
      setMembers((current) => current.map((item) => item.userId === member.userId ? updated : item))
      setDraftReviewerExpertFlags((current) => ({ ...current, [member.userId]: false }))
      setStatusMessage(`${member.email} 审核资格已撤销。`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '审核资格撤销失败')
    } finally {
      setBusyKey('')
    }
  }

  async function handleResend(member: WorkspaceMember) {
    if (!member.invitationId) return
    setBusyKey(`resend:${member.userId}`)
    setSubmitError('')
    try {
      const resent = await resendInvitation(workspace.id, member.invitationId)
      if (resent.activationUrl) {
        setActivationUrl(resent.activationUrl)
        setActivationInvitationId(resent.invitationId)
        setStatusMessage('邀请已重发，激活链接仅显示这一次。')
      } else {
        setActivationUrl('')
        setActivationInvitationId('')
        setStatusMessage(`${resent.email} 已加入当前 Workspace。`)
      }
      await loadMembers()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '邀请重发失败')
    } finally {
      setBusyKey('')
    }
  }

  async function handleRevoke(member: WorkspaceMember) {
    if (!member.invitationId) return
    setBusyKey(`revoke:${member.userId}`)
    setSubmitError('')
    try {
      await revokeInvitation(workspace.id, member.invitationId)
      setStatusMessage(`${member.email} 的邀请已撤销。`)
      await loadMembers()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '邀请撤销失败')
    } finally {
      setBusyKey('')
    }
  }

  async function handleMembershipToggle(member: WorkspaceMember) {
    setBusyKey(`status:${member.userId}`)
    setSubmitError('')
    try {
      const updated = member.membershipStatus === 'active'
        ? await disableMember(workspace.id, member.userId)
        : await enableMember(workspace.id, member.userId)
      setMembers((current) => current.map((item) => item.userId === member.userId ? updated : item))
      setStatusMessage(`${member.email} 成员状态已更新。`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '成员状态更新失败')
    } finally {
      setBusyKey('')
    }
  }

  async function handleUserStatusToggle(member: WorkspaceMember) {
    setBusyKey(`user:${member.userId}`)
    setSubmitError('')
    try {
      const updated = member.userStatus === 'active'
        ? await disableUser(workspace.id, member.userId)
        : await enableUser(workspace.id, member.userId)
      setMembers((current) => current.map((item) => item.userId === member.userId ? updated : item))
      setStatusMessage(`${member.email} User 状态已更新。`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'User 状态更新失败')
    } finally {
      setBusyKey('')
    }
  }

  if (isLoading) {
    return <div className="panel table-state">正在加载成员列表…</div>
  }

  return (
    <section className="members-page">
      <div className="panel members-toolbar">
        <div>
          <p className="section-kicker">WORKSPACE ACCESS</p>
          <h2>成员与权限</h2>
          <span>{workspace.name} 当前有 {activeCount} 名有效成员。</span>
        </div>
        <div className="members-toolbar-actions">
          <button className="button secondary" onClick={() => void loadMembers()}>
            <RefreshCcw size={16} />
            刷新
          </button>
          <button className="button primary" onClick={() => setIsInviteOpen(true)}>
            <MailPlus size={16} />
            邀请成员
          </button>
        </div>
      </div>

      {(statusMessage || submitError || activationUrl) && (
        <div className={`inline-feedback ${submitError ? 'error' : ''}`} role={submitError ? 'alert' : 'status'}>
          <span>{submitError || statusMessage}</span>
          {activationUrl && !submitError && (
            <button className="button ghost compact" disabled={busyKey === 'copy'} onClick={() => void copyActivationLink()}>
              <Copy size={15} />
              复制激活链接
            </button>
          )}
        </div>
      )}

      <div className="panel members-table-panel">
        <table className="members-table">
          <thead>
            <tr>
              <th>成员</th>
              <th>平台角色</th>
              <th>审核资格</th>
              <th>User 状态</th>
              <th>Membership 状态</th>
              <th>最近登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <td>
                  <div className="members-identity">
                    <strong>{member.displayName}</strong>
                    <span>{member.email}</span>
                  </div>
                </td>
                <td>
                  <div className="members-role-cell">
                    <select
                      aria-label={`${member.email} 的角色`}
                      value={draftRoles[member.userId] ?? member.role}
                      onChange={(event) => {
                        setDraftRoles((current) => ({
                          ...current,
                          [member.userId]: event.target.value as WorkspaceRole,
                        }))
                      }}
                    >
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <span className="status-chip neutral">{member.role}</span>
                  </div>
                </td>
                <td>
                  <div className="members-reviewer-cell">
                    <span className={`status-chip ${member.reviewer?.isActive ? 'success' : 'neutral'}`}>
                      {qualificationLabel(member)}
                    </span>
                    <input
                      aria-label={`${member.email} 的审核角色`}
                      value={draftReviewerRoles[member.userId] ?? ''}
                      placeholder="审核角色"
                      onChange={(event) => {
                        setDraftReviewerRoles((current) => ({
                          ...current,
                          [member.userId]: event.target.value,
                        }))
                      }}
                    />
                    <label className="members-inline-toggle">
                      <input
                        aria-label={`${member.email} 专家审核`}
                        type="checkbox"
                        checked={draftReviewerExpertFlags[member.userId] ?? false}
                        onChange={(event) => {
                          setDraftReviewerExpertFlags((current) => ({
                            ...current,
                            [member.userId]: event.target.checked,
                          }))
                        }}
                      />
                      <span>专家</span>
                    </label>
                  </div>
                </td>
                <td><span className="status-chip neutral">{member.userStatus}</span></td>
                <td><span className="status-chip neutral">{member.membershipStatus}</span></td>
                <td>{formatTimestamp(member.lastLoginAt)}</td>
                <td>
                  <div className="members-actions">
                    <button
                      className="icon-button members-action"
                      aria-label={`保存 ${member.email} 的角色`}
                      disabled={busyKey === `role:${member.userId}`}
                      onClick={() => void handleRoleSave(member)}
                      title="保存角色"
                    >
                      <UserCog size={16} />
                    </button>
                    {member.invitationId && member.membershipStatus === 'invited' && (
                      <>
                        <button
                          className="button ghost compact"
                          aria-label={`重发 ${member.email} 邀请`}
                          disabled={busyKey === `resend:${member.userId}`}
                          onClick={() => void handleResend(member)}
                        >
                          重发
                        </button>
                        <button
                          className="button ghost compact"
                          aria-label={`撤销 ${member.email} 邀请`}
                          disabled={busyKey === `revoke:${member.userId}`}
                          onClick={() => void handleRevoke(member)}
                        >
                          撤销
                        </button>
                      </>
                    )}
                    <button
                      className="button ghost compact"
                      aria-label={`保存 ${member.email} 审核资格`}
                      disabled={busyKey === `reviewer:${member.userId}`}
                      onClick={() => void handleReviewerSave(member)}
                    >
                      保存审核
                    </button>
                    {member.reviewer?.isActive && (
                      <button
                        className="button ghost compact"
                        aria-label={`撤销 ${member.email} 审核资格`}
                        disabled={busyKey === `reviewer:${member.userId}`}
                        onClick={() => void handleReviewerRevoke(member)}
                      >
                        撤销审核
                      </button>
                    )}
                    <button
                      className="button ghost compact"
                      aria-label={`${member.membershipStatus === 'active' ? '停用' : '启用'} ${member.email}`}
                      disabled={busyKey === `status:${member.userId}`}
                      onClick={() => void handleMembershipToggle(member)}
                    >
                      <ShieldCheck size={15} />
                      {member.membershipStatus === 'active' ? '停用' : '启用'}
                    </button>
                    <button
                      className="button ghost compact"
                      aria-label={`${member.userStatus === 'active' ? '停用 User' : '启用 User'} ${member.email}`}
                      disabled={busyKey === `user:${member.userId}`}
                      onClick={() => void handleUserStatusToggle(member)}
                    >
                      {member.userStatus === 'active' ? '停用 User' : '启用 User'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isInviteOpen && (
        <div className="dialog-backdrop">
          <section className="agent-dialog members-dialog" role="dialog" aria-modal="true" aria-labelledby="members-dialog-title">
            <header>
              <div>
                <p className="eyebrow">INVITATION</p>
                <h2 id="members-dialog-title">邀请成员</h2>
              </div>
            </header>
            <form onSubmit={handleInvite}>
              <label className="dialog-field">
                <span>邮箱</span>
                <input
                  aria-label="邮箱"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
              </label>
              <label className="dialog-field">
                <span>平台角色</span>
                <select
                  aria-label="平台角色"
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as WorkspaceRole)}
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <footer>
                <button className="button ghost" type="button" onClick={() => setIsInviteOpen(false)}>
                  取消
                </button>
                <button className="button primary" type="submit" disabled={busyKey === 'invite'}>
                  发送邀请
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
