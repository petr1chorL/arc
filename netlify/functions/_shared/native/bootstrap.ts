import { randomUUID } from 'node:crypto'
import type { SqlClient, SqlPool } from '../identity-workspace/postgres.ts'
import { normalizeEmail } from '../identity-workspace/domain.ts'
import { hashPassword } from '../identity-workspace/security.ts'

export type FreshIdentityOptions = { enabled: boolean; loadConfig: () => unknown }
export type FreshIdentityResult = { status: 'disabled' | 'initialized' | 'already_initialized' }

/** Server-only, explicitly enabled first identity provisioning; never accepts HTTP input. */
export async function ensureFreshIdentity(pool: SqlPool, options: FreshIdentityOptions): Promise<FreshIdentityResult> {
  if (!options.enabled) return { status: 'disabled' }
  try {
    return await initializeTransaction(pool, options)
  } catch {
    // Includes connection, configuration, query, rollback and client release errors.
    throw new Error('Fresh identity initialization failed')
  }
}

async function initializeTransaction(pool: SqlPool, options: FreshIdentityOptions): Promise<FreshIdentityResult> {
  let client: SqlClient | undefined
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(1095910223, 1)')
    const marker = await client.query("SELECT id FROM native_bootstrap_state WHERE id='arc-one'")
    if (!marker.rows.length) {
      // Also exclude concurrent ordinary identity writes, not just other bootstrap attempts.
      await client.query('LOCK TABLE organizations, users, workspaces IN SHARE ROW EXCLUSIVE MODE')
      const occupied = await client.query(`SELECT id FROM organizations UNION ALL SELECT id FROM users
        UNION ALL SELECT id FROM workspaces LIMIT 1`)
      if (occupied.rows.length) throw new Error('Nonempty fresh identity target')
      await initialize(client, options.loadConfig())
    }
    await client.query('COMMIT')
    return { status: marker.rows.length ? 'already_initialized' : 'initialized' }
  } catch (error) {
    try { await client?.query('ROLLBACK') } catch { /* Preserve a fixed, credential-free failure. */ }
    throw error
  } finally {
    // Release cannot undo a committed receipt; the outer boundary sanitizes any failure.
    client?.release()
  }
}

function validateConfig(value: unknown): { email: string; password: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bootstrap configuration')
  const { email, password } = value as Record<string, unknown>
  if (typeof email !== 'string' || email.trim().length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim())
    || typeof password !== 'string' || password.length < 12 || password.length > 1024 || !password.trim()) {
    throw new Error('Invalid bootstrap configuration')
  }
  return { email: normalizeEmail(email), password }
}

async function initialize(client: SqlClient, value: unknown): Promise<void> {
  const { email, password } = validateConfig(value)
  const encoded = await hashPassword(password)
  const now = new Date()
  await client.query(`INSERT INTO organizations (id,name,slug,status,created_at,updated_at)
    VALUES ('arc-one','ARC.ONE','arc-one','active',$1,$1)`, [now])
  await client.query(`INSERT INTO users
    (id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,
      failed_login_count,password_changed_at,last_workspace_id,created_at,updated_at)
    VALUES ('arc-one-admin','arc-one',$1,$1,'Administrator',$2,'active',true,0,$3,'arc-one',$3,$3)`, [email, encoded, now])
  await client.query(`INSERT INTO workspaces (id,organization_id,name,slug,status,created_by,created_at,updated_at)
    VALUES ('arc-one','arc-one','ARC.ONE','arc-one','active','arc-one-admin',$1,$1)`, [now])
  await client.query(`INSERT INTO workspace_memberships
    (id,workspace_id,user_id,role,status,activated_at,created_at,updated_at)
    VALUES ('arc-one-admin-membership','arc-one','arc-one-admin','workspace_admin','active',$1,$1,$1)`, [now])
  await client.query(`INSERT INTO audit_events
    (id,workspace_id,organization_id,actor_user_id,action,target_type,target_id,outcome,
      reason,before_status,after_status,payload,metadata,trace_id,created_at)
    VALUES ($1,'arc-one','arc-one','arc-one-admin','identity.bootstrap','organization','arc-one','success',
      'Server-authorized fresh identity initialization','empty','active','{}','{}',$2,$3)`, [randomUUID(), randomUUID(), now])
  await client.query(`INSERT INTO native_bootstrap_state (id,completed_at) VALUES ('arc-one',$1)`, [now])
}
