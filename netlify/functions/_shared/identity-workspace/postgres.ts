import { randomUUID } from 'node:crypto'

import type { BackendInput, BackendResult } from './handler.ts'
import { ApiError } from './handler.ts'
import {
  buildPermissionMatrix,
  can,
  isWorkspaceRole,
  normalizeEmail,
  type Capability,
  type WorkspaceRole,
} from './domain.ts'
import { digestToken, hashPassword, newToken, tokenMatches, verifyPassword } from './security.ts'

type QueryResult<Row> = { rows: Row[]; rowCount: number | null }
type SqlClient = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  release(): void
}
export type SqlPool = { connect(): Promise<SqlClient> }

type UserRow = {
  id: string
  organization_id: string
  email: string | null
  normalized_email: string | null
  display_name: string
  password_hash: string | null
  status: string
  is_organization_admin: boolean
  failed_login_count: number
  locked_until: Date | string | null
  password_changed_at: Date | string | null
  last_login_at: Date | string | null
}

type SessionRow = {
  id: string
  user_id: string
  csrf_digest: string
  created_at: Date | string
  idle_expires_at: Date | string
  absolute_expires_at: Date | string
  revoked_at: Date | string | null
}

type WorkspaceRow = {
  id: string
  organization_id: string
  name: string
  slug: string
  status: string
  created_by: string | null
  created_at: Date | string
  updated_at: Date | string
}

type MembershipRow = {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  status: string
  invited_by: string | null
  activated_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

type InvitationRow = {
  id: string
  organization_id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  token_digest: string
  expires_at: Date | string
  used_at: Date | string | null
  revoked_at: Date | string | null
  created_by: string | null
  created_at: Date | string
}

type InvitationBundle = InvitationRow & {
  email: string | null
  user_status: string
  display_name: string
  workspace_name: string
  membership_id: string
  membership_status: string
}

type MemberRow = MembershipRow & {
  is_organization_admin: boolean
  email: string | null
  display_name: string
  user_status: string
  last_login_at: Date | string | null
  reviewer_role: string | null
  reviewer_is_expert: boolean | null
  reviewer_is_active: boolean | null
  invitation_id: string | null
  invitation_revoked_at: Date | string | null
  invitation_used_at: Date | string | null
}

type AuthContext = {
  user: UserRow
  session: SessionRow
  organizationId: string
}

type AuthQueryRow = UserRow & {
  session_id: string
  session_user_id: string
  csrf_digest: string
  session_created_at: Date | string
  idle_expires_at: Date | string
  absolute_expires_at: Date | string
  revoked_at: Date | string | null
  organization_status: string
}

type WorkspaceContext = AuthContext & {
  workspace: WorkspaceRow
  membership: MembershipRow | null
}

const INVALID_LOGIN = '邮箱或密码错误'
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$sD8yO5nNpV5kB99Fx+0PXw$Zhp9/2C4RjmvqFfVtVdApR3SXofWsvRy1a9W/F0uoKs'
const SESSION_IDLE_MS = 8 * 60 * 60 * 1000
const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000
const INVITATION_MS = 72 * 60 * 60 * 1000

export function createPostgresIdentityWorkspaceBackend(pool: SqlPool) {
  return async (input: BackendInput): Promise<BackendResult> => {
    const client = await pool.connect()
    try {
      // Autocommit the budget before the business transaction: invalid requests count too.
      await enforceRequestRateLimit(client, input)
      await client.query('BEGIN')
      try {
        const result = await dispatch(client, input)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query(error instanceof ApiError && error.commitOnError ? 'COMMIT' : 'ROLLBACK')
        throw error
      }
    } finally {
      client.release()
    }
  }
}

async function enforceRequestRateLimit(client: SqlClient, input: BackendInput): Promise<void> {
  const key = `request:client:${await digestToken(input.clientAddress ?? 'unknown')}`
  const result = await client.query<{ count: number }>(
    `INSERT INTO identity_rate_limits (bucket_key,window_started_at,count)
     VALUES ($1,clock_timestamp(),1)
     ON CONFLICT (bucket_key) DO UPDATE SET
       window_started_at = CASE WHEN identity_rate_limits.window_started_at <= clock_timestamp() - INTERVAL '60 seconds'
         THEN clock_timestamp() ELSE identity_rate_limits.window_started_at END,
       count = CASE WHEN identity_rate_limits.window_started_at <= clock_timestamp() - INTERVAL '60 seconds'
         THEN 1 ELSE identity_rate_limits.count + 1 END
     RETURNING count`,
    [key],
  )
  if (!result.rows[0]) throw new ApiError(503, '服务暂时不可用')
  if (result.rows[0].count > 120) throw new ApiError(429, '请求过于频繁，请稍后再试', false, false, 60)
}

async function dispatch(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  switch (input.route.name) {
    case 'auth.login':
      return login(client, input)
    case 'auth.session':
      return readSession(client, input)
    case 'auth.logout':
      return logout(client, input)
    case 'auth.change-password':
      return changePassword(client, input)
    case 'invitation.preview':
      return previewInvitation(client, input)
    case 'invitation.activate':
      return activateInvitation(client, input)
    case 'workspace.list':
      return listWorkspaces(client, input)
    case 'workspace.create':
      return createWorkspace(client, input)
    case 'workspace.read':
      return readWorkspace(client, input)
    case 'workspace.audit.list':
      return listAuditEvents(client, input)
    case 'workspace.permissions.read':
      return readPermissionMatrix(client, input)
    case 'workspace.members.list':
      return listMembers(client, input)
    case 'workspace.invitation.create':
      return createInvitation(client, input)
    case 'workspace.invitation.copy':
      return copyInvitation(client, input)
    case 'workspace.invitation.resend':
      return resendInvitation(client, input)
    case 'workspace.invitation.revoke':
      return revokeInvitation(client, input)
    case 'workspace.member.role.update':
      return updateMemberRole(client, input)
    case 'workspace.member.disable':
      return setMembershipStatus(client, input, 'disabled')
    case 'workspace.member.enable':
      return setMembershipStatus(client, input, 'active')
    case 'workspace.user.disable':
      return setUserStatus(client, input, 'disabled')
    case 'workspace.user.enable':
      return setUserStatus(client, input, 'active')
    case 'workspace.reviewer.save':
      return saveReviewer(client, input)
    case 'workspace.reviewer.revoke':
      return revokeReviewer(client, input)
  }
}

async function login(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  const body = objectBody(input.body)
  const email = requiredString(body.email, 'email', 3, 320)
  const password = requiredString(body.password, 'password', 12, 1024, false)
  const users = await client.query<UserRow>(
    `SELECT u.* FROM users u
     JOIN organizations o ON o.id = u.organization_id
     WHERE u.normalized_email = $1 AND o.status = 'active'
     ORDER BY u.id LIMIT 2 FOR UPDATE OF u`,
    [normalizeEmail(email)],
  )
  if (users.rows.length > 1) throw new ApiError(500, '认证配置异常')
  const user = users.rows[0]
  if (!user) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH)
    throw new ApiError(401, INVALID_LOGIN)
  }

  const now = new Date()
  if (user.locked_until && toDate(user.locked_until) > now) {
    throw new ApiError(429, INVALID_LOGIN)
  }
  if (user.locked_until) {
    await client.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = $2 WHERE id = $1`,
      [user.id, now],
    )
    user.failed_login_count = 0
    user.locked_until = null
  }

  const valid = user.password_hash ? await verifyPassword(password, user.password_hash) : false
  if (user.status !== 'active' || !valid) {
    const failures = user.failed_login_count + 1
    const lockedUntil = failures >= 5 ? new Date(now.getTime() + 15 * 60 * 1000) : null
    await client.query(
      `UPDATE users
       SET failed_login_count = $2, locked_until = COALESCE($3, locked_until), updated_at = $4
       WHERE id = $1`,
      [user.id, failures, lockedUntil, now],
    )
    throw new ApiError(failures >= 5 ? 429 : 401, INVALID_LOGIN, false, true)
  }

  const sessionToken = newToken()
  const csrfToken = newToken()
  const absolute = new Date(now.getTime() + SESSION_ABSOLUTE_MS)
  const idle = new Date(Math.min(now.getTime() + SESSION_IDLE_MS, absolute.getTime()))
  await client.query(
    `INSERT INTO sessions
      (id, user_id, token_digest, csrf_digest, created_at, last_seen_at,
       idle_expires_at, absolute_expires_at, revoked_at, revoked_reason, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$5,$6,$7,NULL,NULL,$8,$9)`,
    [
      randomUUID(), user.id, await digestToken(sessionToken), await digestToken(csrfToken),
      now, idle, absolute, input.clientAddress, input.request.headers.get('user-agent'),
    ],
  )
  await client.query(
    `UPDATE users SET failed_login_count=0, locked_until=NULL, last_login_at=$2, updated_at=$2 WHERE id=$1`,
    [user.id, now],
  )
  return { status: 200, body: authSession(user), sessionToken, csrfToken }
}

async function readSession(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  const context = await authenticate(client, input.sessionToken)
  return { body: authSession(context.user) }
}

async function logout(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  const context = await authenticate(client, input.sessionToken)
  await requireCsrf(context.session, input.csrfToken)
  await client.query(
    `UPDATE sessions SET revoked_at=$2, revoked_reason='logout' WHERE id=$1 AND revoked_at IS NULL`,
    [context.session.id, new Date()],
  )
  return { status: 204, clearAuthCookies: true }
}

async function changePassword(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  const context = await authenticate(client, input.sessionToken)
  await requireCsrf(context.session, input.csrfToken)
  const body = objectBody(input.body)
  const current = requiredString(body.currentPassword, 'currentPassword', 12, 1024, false)
  const next = requiredString(body.newPassword, 'newPassword', 12, 1024, false)
  if (!context.user.password_hash || !(await verifyPassword(current, context.user.password_hash))) {
    throw new ApiError(422, '当前密码错误')
  }
  if (current === next) throw new ApiError(422, '新密码不能与当前密码相同')
  const now = new Date()
  await client.query(
    `UPDATE users SET password_hash=$2, password_changed_at=$3, updated_at=$3 WHERE id=$1`,
    [context.user.id, await hashPassword(next), now],
  )
  await client.query(
    `UPDATE sessions SET revoked_at=$2, revoked_reason='password_changed'
     WHERE user_id=$1 AND revoked_at IS NULL`,
    [context.user.id, now],
  )
  return { status: 204, clearAuthCookies: true }
}

async function authenticate(client: SqlClient, rawToken: string | null): Promise<AuthContext> {
  if (!rawToken) throw new ApiError(401, '未登录或会话已失效', true)
  const result = await client.query<AuthQueryRow>(
    `SELECT u.*, s.id AS session_id, s.user_id AS session_user_id, s.csrf_digest,
            s.created_at AS session_created_at, s.idle_expires_at, s.absolute_expires_at,
            s.revoked_at, o.status AS organization_status
     FROM sessions s
     JOIN users u ON u.id=s.user_id
     JOIN organizations o ON o.id=u.organization_id
     WHERE s.token_digest=$1
     LIMIT 1 FOR UPDATE OF s`,
    [await digestToken(rawToken)],
  )
  const row = result.rows[0]
  if (!row || row.revoked_at) throw new ApiError(401, '未登录或会话已失效', true)
  const session: SessionRow = {
    id: String(row.session_id),
    user_id: String(row.session_user_id),
    csrf_digest: row.csrf_digest,
    created_at: row.session_created_at,
    idle_expires_at: row.idle_expires_at,
    absolute_expires_at: row.absolute_expires_at,
    revoked_at: row.revoked_at,
  }
  const now = new Date()
  let reason: string | null = null
  if (toDate(session.idle_expires_at) <= now) reason = 'idle_expired'
  else if (toDate(session.absolute_expires_at) <= now) reason = 'absolute_expired'
  else if (row.status !== 'active') reason = 'user_inactive'
  else if (row.organization_status !== 'active') reason = 'organization_inactive'
  else if (row.password_changed_at && toDate(row.password_changed_at) > toDate(session.created_at)) {
    reason = 'password_changed'
  }
  if (reason) {
    await client.query(
      `UPDATE sessions SET revoked_at=$2, revoked_reason=$3 WHERE id=$1 AND revoked_at IS NULL`,
      [session.id, now, reason],
    )
    throw new ApiError(401, '未登录或会话已失效', true, true)
  }
  const nextIdle = new Date(
    Math.min(now.getTime() + SESSION_IDLE_MS, toDate(session.absolute_expires_at).getTime()),
  )
  await client.query(
    `UPDATE sessions SET last_seen_at=$2, idle_expires_at=$3 WHERE id=$1`,
    [session.id, now, nextIdle],
  )
  return { user: row, session, organizationId: row.organization_id }
}

async function requireCsrf(session: SessionRow, token: string | null): Promise<void> {
  if (!token || !(await tokenMatches(token, session.csrf_digest))) {
    throw new ApiError(403, 'CSRF 校验失败')
  }
}

function authSession(user: UserRow) {
  return {
    user: {
      id: user.id,
      email: user.email ?? '',
      displayName: user.display_name,
      isOrganizationAdmin: user.is_organization_admin,
    },
  }
}

async function workspaceContext(
  client: SqlClient,
  input: BackendInput,
  write = false,
): Promise<WorkspaceContext> {
  const auth = await authenticate(client, input.sessionToken)
  if (write) await requireCsrf(auth.session, input.csrfToken)
  const workspaceId = input.route.params.workspaceId
  const workspaces = await client.query<WorkspaceRow>(
    `SELECT * FROM workspaces
     WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1`,
    [workspaceId, auth.organizationId],
  )
  const workspace = workspaces.rows[0]
  if (!workspace) throw new ApiError(404, 'Workspace 不存在')
  let membership: MembershipRow | null = null
  if (!auth.user.is_organization_admin) {
    const memberships = await client.query<MembershipRow>(
      `SELECT * FROM workspace_memberships
       WHERE workspace_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,
      [workspace.id, auth.user.id],
    )
    membership = memberships.rows[0] ?? null
    if (!membership) {
      await recordAudit(client, auth, input, {
        workspaceId: workspace.id,
        action: 'workspace.access_denied',
        targetType: 'workspace',
        targetId: workspace.id,
        outcome: 'denied',
      })
      throw new ApiError(404, 'Workspace 不存在', false, true)
    }
  }
  return { ...auth, workspace, membership }
}

async function requireCapability(
  client: SqlClient,
  context: WorkspaceContext,
  input: BackendInput,
  capability: Capability,
  audit: { action: string; targetType: string; targetId: string | null },
): Promise<void> {
  if (context.user.is_organization_admin) return
  if (context.membership && can(context.membership.role, capability)) return
  await recordAudit(client, context, input, {
    workspaceId: context.workspace.id,
    ...audit,
    outcome: 'denied',
    metadata: { capability },
  })
  throw new ApiError(403, '权限不足', false, true)
}

async function requireOrganizationAdmin(
  client: SqlClient,
  context: AuthContext,
  input: BackendInput,
  audit: { action: string; targetType: string; targetId: string | null; workspaceId?: string | null },
): Promise<void> {
  if (context.user.is_organization_admin) return
  await recordAudit(client, context, input, {
    workspaceId: audit.workspaceId ?? null,
    action: audit.action,
    targetType: audit.targetType,
    targetId: audit.targetId,
    outcome: 'denied',
  })
  throw new ApiError(403, '仅组织管理员可执行此操作', false, true)
}

async function listWorkspaces(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  const context = await authenticate(client, input.sessionToken)
  if (context.user.is_organization_admin) {
    const rows = await client.query<WorkspaceRow>(
      `SELECT * FROM workspaces WHERE organization_id=$1 AND status='active' ORDER BY created_at ASC`,
      [context.organizationId],
    )
    return { body: rows.rows.map((workspace) => ({ ...serializeWorkspace(workspace), role: 'workspace_admin' })) }
  }
  const rows = await client.query<WorkspaceRow & { role: WorkspaceRole }>(
    `SELECT w.*, m.role FROM workspaces w
     JOIN workspace_memberships m ON m.workspace_id=w.id
     WHERE w.organization_id=$1 AND w.status='active' AND m.user_id=$2 AND m.status='active'
     ORDER BY w.created_at ASC`,
    [context.organizationId, context.user.id],
  )
  return { body: rows.rows.map((workspace) => ({ ...serializeWorkspace(workspace), role: workspace.role })) }
}

async function createWorkspace(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  const auth = await authenticate(client, input.sessionToken)
  await requireCsrf(auth.session, input.csrfToken)
  await requireOrganizationAdmin(client, auth, input, {
    action: 'workspace.create', targetType: 'workspace', targetId: null,
  })
  const body = objectBody(input.body)
  const name = requiredString(body.name, 'name', 1, 160)
  const slug = requiredString(body.slug, 'slug', 1, 120)
  const now = new Date()
  const workspace: WorkspaceRow = {
    id: randomUUID(), organization_id: auth.organizationId, name, slug, status: 'active',
    created_by: auth.user.id, created_at: now, updated_at: now,
  }
  try {
    await client.query(
      `INSERT INTO workspaces
       (id, organization_id, name, slug, status, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'active',$5,$6,$6)`,
      [workspace.id, workspace.organization_id, name, slug, auth.user.id, now],
    )
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'Workspace 标识已存在')
    throw error
  }
  await client.query(
    `INSERT INTO workspace_memberships
     (id,workspace_id,user_id,role,status,invited_by,activated_at,created_at,updated_at)
     VALUES ($1,$2,$3,'workspace_admin','active',$3,$4,$4,$4)`,
    [randomUUID(), workspace.id, auth.user.id, now],
  )
  await recordAudit(client, auth, input, {
    workspaceId: workspace.id,
    action: 'workspace.create', targetType: 'workspace', targetId: workspace.id, outcome: 'success',
  })
  return { status: 201, body: serializeWorkspace(workspace) }
}

async function readWorkspace(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  const context = await workspaceContext(client, input)
  return { body: serializeWorkspace(context.workspace) }
}

async function readPermissionMatrix(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  const context = await workspaceContext(client, input)
  await requireCapability(client, context, input, 'member.manage', {
    action: 'permission_matrix.read', targetType: 'workspace', targetId: context.workspace.id,
  })
  return { body: buildPermissionMatrix() }
}

async function listAuditEvents(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  const context = await workspaceContext(client, input)
  await requireCapability(client, context, input, 'audit.read', {
    action: 'audit_event.list', targetType: 'workspace', targetId: context.workspace.id,
  })
  const url = new URL(input.request.url)
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200)
  const clauses = ['workspace_id=$1']
  const values: unknown[] = [context.workspace.id]
  for (const [queryName, column] of [
    ['action', 'action'], ['targetType', 'target_type'], ['outcome', 'outcome'], ['traceId', 'trace_id'],
  ] as const) {
    const value = url.searchParams.get(queryName)
    if (value) {
      values.push(value)
      clauses.push(`${column}=$${values.length}`)
    }
  }
  values.push(limit)
  const rows = await client.query<Record<string, unknown>>(
    `SELECT * FROM audit_events WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
    values,
  )
  return {
    body: rows.rows.map((row) => ({
      id: row.id, action: row.action ?? '', targetType: row.target_type,
      targetId: row.target_id, outcome: row.outcome ?? '', reason: row.reason ?? '',
      actorId: row.actor_user_id ?? row.actor_id, requestId: row.request_id,
      traceId: row.trace_id ?? '', spanId: row.span_id,
      createdAt: iso(row.created_at), metadata: row.metadata ?? {},
    })),
  }
}

function serializeWorkspace(workspace: WorkspaceRow) {
  return {
    id: workspace.id,
    organizationId: workspace.organization_id,
    name: workspace.name,
    slug: workspace.slug,
    status: workspace.status,
    createdBy: workspace.created_by,
    createdAt: iso(workspace.created_at),
    updatedAt: iso(workspace.updated_at),
  }
}

async function recordAudit(
  client: SqlClient,
  context: AuthContext,
  input: BackendInput,
  event: {
    workspaceId: string | null
    action: string
    targetType: string
    targetId: string | null
    outcome: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
     (id,workspace_id,organization_id,human_task_id,actor_user_id,session_id,action,target_type,
      target_id,outcome,request_id,ip_address,metadata,event_type,actor_id,reason,before_status,
      after_status,payload,trace_id,span_id,created_at)
     VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NULL,'','','',$13,'',NULL,$14)`,
    [
      randomUUID(), event.workspaceId, context.organizationId, context.user.id, context.session.id,
      event.action, event.targetType, event.targetId, event.outcome,
      input.request.headers.get('X-Request-ID'), input.clientAddress, event.metadata ?? {}, {}, new Date(),
    ],
  )
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(422, '请求正文格式错误')
  }
  return value as Record<string, unknown>
}

function requiredString(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  trim = true,
): string {
  if (typeof value !== 'string') throw new ApiError(422, `${field} 字段无效`)
  const normalized = trim ? value.trim() : value
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ApiError(422, `${field} 字段无效`)
  }
  return normalized
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return new Date(String(value)).toISOString()
}

function clampInt(value: string | null, fallback: number, minimum: number, maximum: number): number {
  if (value === null) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

// Implemented in the membership/invitation section below.
async function previewInvitation(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  return invitationPreviewOrActivation(client, input, false)
}
async function activateInvitation(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  return invitationPreviewOrActivation(client, input, true)
}
async function listMembers(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  return memberOperations(client, input, 'list')
}
async function createInvitation(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  return memberOperations(client, input, 'invite')
}
async function copyInvitation(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  return memberOperations(client, input, 'copy')
}
async function resendInvitation(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  return memberOperations(client, input, 'resend')
}
async function revokeInvitation(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  return memberOperations(client, input, 'revoke-invitation')
}
async function updateMemberRole(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  return memberOperations(client, input, 'role')
}
async function setMembershipStatus(client: SqlClient, input: BackendInput, status: 'active' | 'disabled'): Promise<BackendResult> {
  return memberOperations(client, input, status === 'active' ? 'enable-member' : 'disable-member')
}
async function setUserStatus(client: SqlClient, input: BackendInput, status: 'active' | 'disabled'): Promise<BackendResult> {
  return memberOperations(client, input, status === 'active' ? 'enable-user' : 'disable-user')
}
async function saveReviewer(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  return memberOperations(client, input, 'save-reviewer')
}
async function revokeReviewer(client: SqlClient, input: BackendInput): Promise<BackendResult> {
  return memberOperations(client, input, 'revoke-reviewer')
}

async function invitationPreviewOrActivation(
  client: SqlClient,
  input: BackendInput,
  activate: boolean,
): Promise<BackendResult> {
  const token = input.route.params.token
  await enforceInvitationRateLimit(client, input, token, activate ? 'activate' : 'preview')
  try {
    return await resolveInvitationRequest(client, input, activate, token)
  } catch (error) {
    if (error instanceof ApiError) {
      throw new ApiError(error.status, error.message, error.clearAuthCookies, true)
    }
    throw error
  }
}

async function resolveInvitationRequest(
  client: SqlClient,
  input: BackendInput,
  activate: boolean,
  token: string,
): Promise<BackendResult> {
  const tokenDigest = await digestToken(token)
  const result = await client.query<InvitationBundle>(
    `SELECT i.*, u.email, u.status AS user_status, u.display_name,
            w.name AS workspace_name, m.id AS membership_id, m.status AS membership_status
     FROM invitations i
     JOIN users u ON u.id=i.user_id
     JOIN workspaces w ON w.id=i.workspace_id
     JOIN workspace_memberships m ON m.workspace_id=i.workspace_id AND m.user_id=i.user_id
     WHERE i.token_digest=$1 LIMIT 1 FOR UPDATE OF i,u,m`,
    [tokenDigest],
  )
  const invitation = result.rows[0]
  if (!invitation) throw new ApiError(409, '邀请已失效')
  const now = new Date()
  if (invitation.revoked_at) throw new ApiError(409, '邀请已撤销')
  if (invitation.used_at) throw new ApiError(409, '邀请已使用')
  if (toDate(invitation.expires_at) <= now) throw new ApiError(409, '邀请已过期')
  if (invitation.user_status === 'disabled') throw new ApiError(409, '该用户已被停用')
  if (invitation.user_status !== 'pending_email') throw new ApiError(409, '邀请已失效')
  if (!activate) {
    return {
      body: {
        email: invitation.email ?? '',
        workspaceName: invitation.workspace_name,
        role: invitation.role,
        expiresAt: iso(invitation.expires_at),
      },
    }
  }

  const body = objectBody(input.body)
  const displayName = requiredString(body.displayName, 'displayName', 1, 160)
  const password = requiredString(body.password, 'password', 12, 1024, false)
  await client.query(
    `UPDATE users
     SET display_name=$2,password_hash=$3,password_changed_at=$4,status='active',failed_login_count=0,
         locked_until=NULL,last_workspace_id=$5,updated_at=$4
     WHERE id=$1`,
    [invitation.user_id, displayName, await hashPassword(password), now, invitation.workspace_id],
  )
  await client.query(
    `UPDATE workspace_memberships
     SET status='active',role=$2,activated_at=$3,updated_at=$3 WHERE id=$1`,
    [invitation.membership_id, invitation.role, now],
  )
  await client.query(`UPDATE invitations SET used_at=$2 WHERE id=$1`, [invitation.id, now])
  await client.query(
    `INSERT INTO audit_events
     (id,workspace_id,organization_id,human_task_id,actor_user_id,session_id,action,target_type,
      target_id,outcome,request_id,ip_address,metadata,event_type,actor_id,reason,before_status,
      after_status,payload,trace_id,span_id,created_at)
     VALUES ($1,$2,$3,NULL,$4,NULL,'member.invitation.activate','invitation',$5,'success',$6,$7,$8,
             NULL,NULL,'','','',$9,'',NULL,$10)`,
    [
      randomUUID(), invitation.workspace_id, invitation.organization_id, invitation.user_id,
      invitation.id, input.request.headers.get('X-Request-ID'), input.clientAddress,
      { userId: invitation.user_id }, {}, now,
    ],
  )
  return { status: 204 }
}

async function memberOperations(
  client: SqlClient,
  input: BackendInput,
  operation: string,
): Promise<BackendResult> {
  const write = operation !== 'list'
  if (write && input.sessionToken) {
    // Lock only the organization first; all membership writes share this order.
    await client.query(
      `SELECT o.id FROM organizations o JOIN users u ON u.organization_id=o.id
       JOIN sessions s ON s.user_id=u.id WHERE s.token_digest=$1
       AND s.revoked_at IS NULL AND u.status='active' FOR UPDATE OF o`,
      [await digestToken(input.sessionToken)],
    )
  }
  const context = await workspaceContext(client, input, write)
  const capability: Capability = operation.startsWith('save-reviewer') || operation.startsWith('revoke-reviewer')
    ? 'reviewer.manage'
    : 'member.manage'
  await requireCapability(client, context, input, capability, {
    action: memberAuditAction(operation),
    targetType: operation.includes('invitation') || ['invite', 'copy', 'resend'].includes(operation)
      ? 'invitation'
      : operation.includes('reviewer') ? 'reviewer' : 'membership',
    targetId: input.route.params.invitationId ?? input.route.params.userId ?? context.workspace.id,
  })

  if (operation === 'list') {
    const members = await queryMembers(client, context.workspace.id)
    return { body: members.map(serializeMember) }
  }
  if (operation === 'invite') return inviteMember(client, context, input)
  if (operation === 'copy') return invitationCopy(client, context, input)
  if (operation === 'resend') return invitationResend(client, context, input)
  if (operation === 'revoke-invitation') return invitationRevoke(client, context, input)

  const userId = input.route.params.userId
  const member = await findMember(client, context.workspace.id, userId)
  if (operation === 'role') return changeMemberRole(client, context, input, member)
  if (operation === 'disable-member' || operation === 'enable-member') {
    return changeMembershipStatus(client, context, input, member, operation === 'enable-member')
  }
  if (operation === 'disable-user' || operation === 'enable-user') {
    return changeUserStatus(client, context, input, member, operation === 'enable-user')
  }
  if (operation === 'save-reviewer') return saveReviewerRecord(client, context, input, member)
  if (operation === 'revoke-reviewer') return revokeReviewerRecord(client, context, input, member)
  throw new ApiError(404, 'Not Found')
}

async function enforceInvitationRateLimit(
  client: SqlClient,
  input: BackendInput,
  token: string,
  action: string,
): Promise<void> {
  const now = new Date()
  const clientId = input.clientAddress ?? 'unknown'
  const keys = [
    `${action}:client:${clientId}`,
    `${action}:token:${clientId}:${await digestToken(token)}`,
  ]
  for (const key of keys) {
    const result = await client.query<{ count: number }>(
      `INSERT INTO identity_rate_limits (bucket_key,window_started_at,count)
       VALUES ($1,$2,1)
       ON CONFLICT (bucket_key) DO UPDATE SET
         window_started_at = CASE
           WHEN identity_rate_limits.window_started_at <= $2 - INTERVAL '1 hour' THEN $2
           ELSE identity_rate_limits.window_started_at END,
         count = CASE
           WHEN identity_rate_limits.window_started_at <= $2 - INTERVAL '1 hour' THEN 1
           ELSE identity_rate_limits.count + 1 END
       RETURNING count`,
      [key, now],
    )
    if ((result.rows[0]?.count ?? 0) > 20) {
      throw new ApiError(429, '请求过于频繁，请稍后再试', false, true)
    }
  }
}

async function queryMembers(client: SqlClient, workspaceId: string): Promise<MemberRow[]> {
  const result = await client.query<MemberRow>(
    `SELECT m.*,u.email,u.display_name,u.status AS user_status,u.last_login_at,u.is_organization_admin,
            r.role AS reviewer_role,r.is_expert AS reviewer_is_expert,r.is_active AS reviewer_is_active,
            i.id AS invitation_id,i.revoked_at AS invitation_revoked_at,i.used_at AS invitation_used_at
     FROM workspace_memberships m
     JOIN users u ON u.id=m.user_id
     LEFT JOIN reviewers r ON r.workspace_id=m.workspace_id AND r.user_id=m.user_id
     LEFT JOIN LATERAL (
       SELECT id,revoked_at,used_at FROM invitations
       WHERE workspace_id=m.workspace_id AND user_id=m.user_id
       ORDER BY created_at DESC LIMIT 1
     ) i ON true
     WHERE m.workspace_id=$1 ORDER BY m.created_at ASC`,
    [workspaceId],
  )
  return result.rows
}

async function findMember(client: SqlClient, workspaceId: string, userId: string): Promise<MemberRow> {
  const result = await client.query<MemberRow>(
    `SELECT m.*,u.email,u.display_name,u.status AS user_status,u.last_login_at,u.is_organization_admin,
            r.role AS reviewer_role,r.is_expert AS reviewer_is_expert,r.is_active AS reviewer_is_active,
            i.id AS invitation_id,i.revoked_at AS invitation_revoked_at,i.used_at AS invitation_used_at
     FROM workspace_memberships m
     JOIN users u ON u.id=m.user_id
     LEFT JOIN reviewers r ON r.workspace_id=m.workspace_id AND r.user_id=m.user_id
     LEFT JOIN LATERAL (
       SELECT id,revoked_at,used_at FROM invitations
       WHERE workspace_id=m.workspace_id AND user_id=m.user_id
       ORDER BY created_at DESC LIMIT 1
     ) i ON true
     WHERE m.workspace_id=$1 AND m.user_id=$2 LIMIT 1 FOR UPDATE OF m,u`,
    [workspaceId, userId],
  )
  if (!result.rows[0]) throw new ApiError(404, '成员不存在')
  return result.rows[0]
}

function serializeMember(member: MemberRow) {
  const activeInvitation = member.invitation_id && !member.invitation_revoked_at && !member.invitation_used_at
  return {
    userId: member.user_id,
    invitationId: activeInvitation ? member.invitation_id : null,
    email: member.email ?? '',
    displayName: member.display_name,
    role: member.role,
    userStatus: member.user_status,
    membershipStatus: member.status,
    reviewer: member.reviewer_role === null ? null : {
      role: member.reviewer_role,
      isExpert: Boolean(member.reviewer_is_expert),
      isActive: Boolean(member.reviewer_is_active),
    },
    lastLoginAt: member.last_login_at ? iso(member.last_login_at) : null,
  }
}

async function inviteMember(
  client: SqlClient,
  context: WorkspaceContext,
  input: BackendInput,
): Promise<BackendResult> {
  const body = objectBody(input.body)
  const email = normalizeEmail(requiredString(body.email, 'email', 3, 320))
  if (!isWorkspaceRole(body.role)) throw new ApiError(422, 'role 字段无效')
  const role = body.role
  const now = new Date()
  let user = (await client.query<UserRow>(
    `SELECT * FROM users WHERE organization_id=$1 AND normalized_email=$2 LIMIT 1 FOR UPDATE`,
    [context.organizationId, email],
  )).rows[0]
  if (!user) {
    const id = randomUUID()
    await client.query(
      `INSERT INTO users
       (id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,
        failed_login_count,locked_until,password_changed_at,last_login_at,last_workspace_id,created_at,updated_at)
       VALUES ($1,$2,$3,$3,$3,NULL,'pending_email',false,0,NULL,NULL,NULL,NULL,$4,$4)`,
      [id, context.organizationId, email, now],
    )
    user = {
      id, organization_id: context.organizationId, email, normalized_email: email,
      display_name: email, password_hash: null, status: 'pending_email',
      is_organization_admin: false, failed_login_count: 0, locked_until: null,
      password_changed_at: null, last_login_at: null,
    }
  }
  if (user.status === 'disabled') throw new ApiError(409, '该用户已被停用')
  let membership = (await client.query<MembershipRow>(
    `SELECT * FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 LIMIT 1 FOR UPDATE`,
    [context.workspace.id, user.id],
  )).rows[0]
  if (membership?.status === 'active') throw new ApiError(409, '该成员已在当前 Workspace 中')

  if (user.status === 'active') {
    await client.query(
      `UPDATE invitations SET revoked_at=$3
       WHERE workspace_id=$1 AND user_id=$2 AND used_at IS NULL AND revoked_at IS NULL`,
      [context.workspace.id, user.id, now],
    )
    if (membership) {
      await client.query(
        `UPDATE workspace_memberships
         SET role=$2,status='active',invited_by=$3,activated_at=COALESCE(activated_at,$4),updated_at=$4
         WHERE id=$1`,
        [membership.id, role, context.user.id, now],
      )
      membership.role = role
    } else {
      membership = newMembership(context.workspace.id, user.id, role, context.user.id, now, 'active')
      await insertMembership(client, membership)
    }
    await recordAudit(client, context, input, {
      workspaceId: context.workspace.id, action: 'member.add', targetType: 'membership',
      targetId: membership.id, outcome: 'success', metadata: { userId: user.id, role },
    })
    return { status: 201, body: { invitationId: '', email: user.email ?? email, role, expiresAt: now.toISOString(), activationUrl: null } }
  }

  if (membership) {
    await client.query(
      `UPDATE workspace_memberships
       SET role=$2,status='invited',invited_by=$3,activated_at=NULL,updated_at=$4 WHERE id=$1`,
      [membership.id, role, context.user.id, now],
    )
  } else {
    membership = newMembership(context.workspace.id, user.id, role, context.user.id, now, 'invited')
    await insertMembership(client, membership)
  }
  const rawToken = newToken()
  const expires = new Date(now.getTime() + INVITATION_MS)
  let invitation = (await client.query<InvitationRow>(
    `SELECT * FROM invitations WHERE workspace_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [context.workspace.id, user.id],
  )).rows[0]
  if (invitation) {
    await client.query(
      `UPDATE invitations SET role=$2,token_digest=$3,expires_at=$4,used_at=NULL,revoked_at=NULL,
       created_by=$5,created_at=$6 WHERE id=$1`,
      [invitation.id, role, await digestToken(rawToken), expires, context.user.id, now],
    )
    invitation.role = role
    invitation.expires_at = expires
  } else {
    invitation = {
      id: randomUUID(), organization_id: context.organizationId, workspace_id: context.workspace.id,
      user_id: user.id, role, token_digest: await digestToken(rawToken), expires_at: expires,
      used_at: null, revoked_at: null, created_by: context.user.id, created_at: now,
    }
    await client.query(
      `INSERT INTO invitations
       (id,organization_id,workspace_id,user_id,role,token_digest,expires_at,used_at,revoked_at,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9)`,
      [invitation.id, invitation.organization_id, invitation.workspace_id, invitation.user_id,
        role, invitation.token_digest, expires, context.user.id, now],
    )
  }
  await recordAudit(client, context, input, {
    workspaceId: context.workspace.id, action: 'member.invitation.create', targetType: 'invitation',
    targetId: invitation.id, outcome: 'success', metadata: { userId: user.id, role },
  })
  return { status: 201, body: invitationLink(input.request, invitation, user.email ?? email, rawToken) }
}

function newMembership(
  workspaceId: string, userId: string, role: WorkspaceRole, invitedBy: string,
  now: Date, status: 'active' | 'invited',
): MembershipRow {
  return {
    id: randomUUID(), workspace_id: workspaceId, user_id: userId, role, status,
    invited_by: invitedBy, activated_at: status === 'active' ? now : null,
    created_at: now, updated_at: now,
  }
}

async function insertMembership(client: SqlClient, membership: MembershipRow): Promise<void> {
  await client.query(
    `INSERT INTO workspace_memberships
     (id,workspace_id,user_id,role,status,invited_by,activated_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
    [membership.id, membership.workspace_id, membership.user_id, membership.role, membership.status,
      membership.invited_by, membership.activated_at, membership.created_at],
  )
}

async function invitationCopy(
  client: SqlClient, context: WorkspaceContext, input: BackendInput,
): Promise<BackendResult> {
  const invitation = await getInvitation(client, context.workspace.id, input.route.params.invitationId)
  if (invitation.revoked_at || invitation.used_at) throw new ApiError(409, '邀请不可复制')
  await recordAudit(client, context, input, {
    workspaceId: context.workspace.id, action: 'member.invitation.copy_link', targetType: 'invitation',
    targetId: invitation.id, outcome: 'success', metadata: { userId: invitation.user_id },
  })
  return { status: 204 }
}

async function invitationResend(
  client: SqlClient, context: WorkspaceContext, input: BackendInput,
): Promise<BackendResult> {
  const invitation = await getInvitation(client, context.workspace.id, input.route.params.invitationId)
  if (invitation.used_at) throw new ApiError(409, '邀请已使用')
  const user = (await client.query<UserRow>(`SELECT * FROM users WHERE id=$1 LIMIT 1 FOR UPDATE`, [invitation.user_id])).rows[0]
  if (!user) throw new ApiError(409, '邀请已失效')
  if (user.status === 'disabled') throw new ApiError(409, '该用户已被停用')
  if (user.status !== 'pending_email') throw new ApiError(409, '邀请已失效')
  const token = newToken()
  const now = new Date()
  invitation.token_digest = await digestToken(token)
  invitation.expires_at = new Date(now.getTime() + INVITATION_MS)
  await client.query(
    `UPDATE invitations SET token_digest=$2,expires_at=$3,revoked_at=NULL,created_by=$4,created_at=$5 WHERE id=$1`,
    [invitation.id, invitation.token_digest, invitation.expires_at, context.user.id, now],
  )
  await recordAudit(client, context, input, {
    workspaceId: context.workspace.id, action: 'member.invitation.resend', targetType: 'invitation',
    targetId: invitation.id, outcome: 'success', metadata: { userId: user.id },
  })
  return { body: invitationLink(input.request, invitation, user.email ?? '', token) }
}

async function invitationRevoke(
  client: SqlClient, context: WorkspaceContext, input: BackendInput,
): Promise<BackendResult> {
  const invitation = await getInvitation(client, context.workspace.id, input.route.params.invitationId)
  if (invitation.used_at) throw new ApiError(409, '邀请已使用')
  await client.query(`UPDATE invitations SET revoked_at=$2 WHERE id=$1`, [invitation.id, new Date()])
  await recordAudit(client, context, input, {
    workspaceId: context.workspace.id, action: 'member.invitation.revoke', targetType: 'invitation',
    targetId: invitation.id, outcome: 'success', metadata: { userId: invitation.user_id },
  })
  return { status: 204 }
}

async function getInvitation(client: SqlClient, workspaceId: string, invitationId: string): Promise<InvitationRow> {
  const row = (await client.query<InvitationRow>(
    `SELECT * FROM invitations WHERE id=$1 AND workspace_id=$2 LIMIT 1 FOR UPDATE`,
    [invitationId, workspaceId],
  )).rows[0]
  if (!row) throw new ApiError(404, '邀请不存在')
  return row
}

function invitationLink(request: Request, invitation: InvitationRow, email: string, rawToken: string) {
  return {
    invitationId: invitation.id,
    email,
    role: invitation.role,
    expiresAt: iso(invitation.expires_at),
    activationUrl: `${new URL(request.url).origin}/activate/${rawToken}`,
  }
}

async function changeMemberRole(
  client: SqlClient, context: WorkspaceContext, input: BackendInput, member: MemberRow,
): Promise<BackendResult> {
  const body = objectBody(input.body)
  if (!isWorkspaceRole(body.role)) throw new ApiError(422, 'role 字段无效')
  if (isEffectiveAdmin(member) && body.role !== 'workspace_admin') {
    await protectLastAdmin(client, context.workspace.id)
  }
  await client.query(`UPDATE workspace_memberships SET role=$2,updated_at=$3 WHERE id=$1`, [member.id, body.role, new Date()])
  await recordAudit(client, context, input, {
    workspaceId: context.workspace.id, action: 'member.role.update', targetType: 'membership',
    targetId: member.id, outcome: 'success', metadata: { userId: member.user_id, role: body.role },
  })
  return { body: serializeMember({ ...member, role: body.role }) }
}

async function changeMembershipStatus(
  client: SqlClient, context: WorkspaceContext, input: BackendInput, member: MemberRow, enable: boolean,
): Promise<BackendResult> {
  if (!enable && context.user.id === member.user_id) throw new ApiError(409, '不能停用自己的成员关系')
  if (!enable && isEffectiveAdmin(member)) {
    await protectLastAdmin(client, context.workspace.id)
  }
  if (enable && member.user_status !== 'active') throw new ApiError(409, '用户尚未激活')
  const status = enable ? 'active' : 'disabled'
  await client.query(`UPDATE workspace_memberships SET status=$2,updated_at=$3 WHERE id=$1`, [member.id, status, new Date()])
  await recordAudit(client, context, input, {
    workspaceId: context.workspace.id, action: enable ? 'member.enable' : 'member.disable',
    targetType: 'membership', targetId: member.id, outcome: 'success', metadata: { userId: member.user_id },
  })
  return { body: serializeMember({ ...member, status }) }
}

async function changeUserStatus(
  client: SqlClient, context: WorkspaceContext, input: BackendInput, member: MemberRow, enable: boolean,
): Promise<BackendResult> {
  await requireOrganizationAdmin(client, context, input, {
    action: enable ? 'user.enable' : 'user.disable', targetType: 'user', targetId: member.user_id,
    workspaceId: context.workspace.id,
  })
  if (!enable && context.user.id === member.user_id) throw new ApiError(409, '不能停用自己的 User')
  if (!enable && member.user_status === 'active' && !member.is_organization_admin) {
    const memberships = await client.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM workspace_memberships
       WHERE user_id=$1 AND role='workspace_admin' AND status='active' ORDER BY workspace_id`,
      [member.user_id],
    )
    for (const membership of memberships.rows) await protectLastAdmin(client, membership.workspace_id)
  }
  const status = enable ? 'active' : 'disabled'
  await client.query(
    `UPDATE users SET status=$2,failed_login_count=CASE WHEN $3 THEN 0 ELSE failed_login_count END,
     locked_until=CASE WHEN $3 THEN NULL ELSE locked_until END,updated_at=$4 WHERE id=$1`,
    [member.user_id, status, enable, new Date()],
  )
  if (!enable) {
    await client.query(
      `UPDATE sessions SET revoked_at=$2,revoked_reason='user_disabled'
       WHERE user_id=$1 AND revoked_at IS NULL`,
      [member.user_id, new Date()],
    )
  }
  await recordAudit(client, context, input, {
    workspaceId: context.workspace.id, action: enable ? 'user.enable' : 'user.disable',
    targetType: 'user', targetId: member.user_id, outcome: 'success',
    metadata: { workspaceId: context.workspace.id },
  })
  return { body: serializeMember({ ...member, user_status: status }) }
}

function isEffectiveAdmin(member: MemberRow): boolean {
  return member.role === 'workspace_admin' && member.status === 'active'
    && member.user_status === 'active' && !member.is_organization_admin
}

async function protectLastAdmin(client: SqlClient, workspaceId: string): Promise<void> {
  const admins = await client.query<{ id: string }>(
    `SELECT m.id FROM workspace_memberships m JOIN users u ON u.id=m.user_id
     WHERE m.workspace_id=$1 AND m.role='workspace_admin' AND m.status='active'
       AND u.status='active' AND u.is_organization_admin=false
     ORDER BY m.id`,
    [workspaceId],
  )
  if (admins.rows.length <= 1) {
    throw new ApiError(409, '必须至少保留一名有效 Workspace 管理员')
  }
}

async function saveReviewerRecord(
  client: SqlClient, context: WorkspaceContext, input: BackendInput, member: MemberRow,
): Promise<BackendResult> {
  if (member.user_status !== 'active' || member.status !== 'active') {
    throw new ApiError(409, 'Reviewer qualification requires an active user and membership')
  }
  const body = objectBody(input.body)
  const role = requiredString(body.role, 'role', 1, 80)
  const isExpert = body.isExpert === undefined ? false : body.isExpert
  if (typeof isExpert !== 'boolean') throw new ApiError(422, 'isExpert 字段无效')
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM reviewers WHERE workspace_id=$1 AND user_id=$2 LIMIT 1 FOR UPDATE`,
    [context.workspace.id, member.user_id],
  )
  const reviewerId = existing.rows[0]?.id ?? randomUUID()
  const action = existing.rows[0] ? 'reviewer.update' : 'reviewer.grant'
  if (existing.rows[0]) {
    await client.query(
      `UPDATE reviewers SET name=$2,role=$3,is_expert=$4,is_active=true WHERE id=$1`,
      [reviewerId, member.display_name, role, isExpert],
    )
  } else {
    await client.query(
      `INSERT INTO reviewers (id,workspace_id,user_id,name,role,is_expert,is_active,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7)`,
      [reviewerId, context.workspace.id, member.user_id, member.display_name, role, isExpert, new Date()],
    )
  }
  await recordAudit(client, context, input, {
    workspaceId: context.workspace.id, action, targetType: 'reviewer', targetId: reviewerId,
    outcome: 'success', metadata: { userId: member.user_id, role, isExpert },
  })
  return { body: serializeMember({
    ...member, reviewer_role: role, reviewer_is_expert: isExpert, reviewer_is_active: true,
  }) }
}

async function revokeReviewerRecord(
  client: SqlClient, context: WorkspaceContext, input: BackendInput, member: MemberRow,
): Promise<BackendResult> {
  const reviewer = await client.query<{ id: string }>(
    `SELECT id FROM reviewers WHERE workspace_id=$1 AND user_id=$2 LIMIT 1 FOR UPDATE`,
    [context.workspace.id, member.user_id],
  )
  if (!reviewer.rows[0]) throw new ApiError(404, 'Reviewer qualification does not exist')
  await client.query(`UPDATE reviewers SET is_active=false,is_expert=false WHERE id=$1`, [reviewer.rows[0].id])
  await recordAudit(client, context, input, {
    workspaceId: context.workspace.id, action: 'reviewer.revoke', targetType: 'reviewer',
    targetId: reviewer.rows[0].id, outcome: 'success', metadata: { userId: member.user_id },
  })
  return { body: serializeMember({
    ...member, reviewer_is_expert: false, reviewer_is_active: false,
  }) }
}

function memberAuditAction(operation: string): string {
  return ({
    list: 'member.list', invite: 'member.invitation.create', copy: 'member.invitation.copy_link',
    resend: 'member.invitation.resend', 'revoke-invitation': 'member.invitation.revoke',
    role: 'member.role.update', 'disable-member': 'member.disable', 'enable-member': 'member.enable',
    'disable-user': 'user.disable', 'enable-user': 'user.enable',
    'save-reviewer': 'reviewer.update', 'revoke-reviewer': 'reviewer.revoke',
  } as Record<string, string>)[operation] ?? operation
}
