import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildPermissionMatrix,
  can,
  normalizeEmail,
} from '../netlify/functions/_shared/identity-workspace/domain.ts'
import {
  digestToken,
  hashPassword,
  verifyPassword,
} from '../netlify/functions/_shared/identity-workspace/security.ts'
import {
  IDENTITY_WORKSPACE_ROUTES,
  resolveIdentityWorkspaceRoute,
} from '../netlify/functions/_shared/identity-workspace/routes.ts'
import {
  ApiError,
  createIdentityWorkspaceHandler,
} from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'

describe('Netlify identity/workspace security primitives', () => {
  it('normalizes email without changing the external response value', () => {
    expect(normalizeEmail('  Admin@Example.Invalid ')).toBe('admin@example.invalid')
  })

  it('verifies a Python argon2-cffi compatible PHC string', async () => {
    const pythonArgon2Fixture =
      '$argon2id$v=19$m=65536,t=3,p=4$aDyKH1F/wTEq5XGUlnqKUw$XuDAaTrn2LTNBU6GQ9FGKxkTRNTUpUeZZQWFMDQV/Ks'

    expect(await verifyPassword('Preview Admin Password 42!', pythonArgon2Fixture)).toBe(true)
    expect(await verifyPassword('wrong password', pythonArgon2Fixture)).toBe(false)
  })

  it('generates a PHC hash that can be verified without retaining plaintext', async () => {
    const encoded = await hashPassword('Another Test Password 42!')

    expect(encoded).toMatch(/^\$argon2id\$v=19\$/)
    expect(encoded).not.toContain('Another Test Password 42!')
    expect(await verifyPassword('Another Test Password 42!', encoded)).toBe(true)
  })

  it('uses a stable SHA-256 token digest', async () => {
    expect(await digestToken('arc-one-token')).toBe(
      '684a6134d27c9f2c42ee39f9f72b31b60ee5ca728f273abb60a89cfc4f9bf21a',
    )
  })
})

describe('Netlify identity/workspace RBAC', () => {
  it('keeps the existing four-role capability matrix', () => {
    expect(can('viewer', 'asset.read')).toBe(true)
    expect(can('viewer', 'member.manage')).toBe(false)
    expect(can('builder', 'agent.publish')).toBe(true)
    expect(can('workspace_admin', 'audit.export')).toBe(true)

    const matrix = buildPermissionMatrix()
    expect(matrix.roles).toEqual(['viewer', 'operator', 'builder', 'workspace_admin'])
    expect(matrix.matrix).toHaveLength(4)
    expect(matrix.reviewerQualificationNote).toContain('Reviewer')
  })
})

describe('Netlify identity/workspace route isolation', () => {
  it('accepts only the migrated route and method combinations', () => {
    expect(resolveIdentityWorkspaceRoute('POST', '/api/auth/login')).toEqual({
      name: 'auth.login',
      params: {},
    })
    expect(resolveIdentityWorkspaceRoute('GET', '/api/workspaces/ws-1/members')).toEqual({
      name: 'workspace.members.list',
      params: { workspaceId: 'ws-1' },
    })
    expect(resolveIdentityWorkspaceRoute('GET', '/api/workspaces/ws-1/agents')).toBeNull()
    expect(resolveIdentityWorkspaceRoute('GET', '/api/workflows')).toBeNull()
    expect(resolveIdentityWorkspaceRoute('POST', '/api/auth/session')).toBeNull()
  })

  it('keeps every native redirect above the Zeabur fallback', () => {
    const config = readFileSync('netlify.toml', 'utf8')
    const fallbackIndex = config.indexOf('from = "/api/*"')

    expect(fallbackIndex).toBeGreaterThan(-1)
    for (const route of IDENTITY_WORKSPACE_ROUTES) {
      const redirectIndex = config.indexOf(`from = "${route.redirectFrom}"`)
      expect(redirectIndex, route.name).toBeGreaterThan(-1)
      expect(redirectIndex, route.name).toBeLessThan(fallbackIndex)
    }
    expect(config).not.toContain('from = "/api/workspaces/*"')
  })
})

describe('Netlify identity/workspace HTTP contract', () => {
  it('sets secure session and CSRF cookies after login', async () => {
    const handler = createIdentityWorkspaceHandler(async (input) => {
      expect(input.route.name).toBe('auth.login')
      expect(input.body).toEqual({ email: 'admin@example.invalid', password: 'long password' })
      return {
        status: 200,
        body: {
          user: {
            id: 'user-1',
            email: 'admin@example.invalid',
            displayName: 'Preview Admin',
            isOrganizationAdmin: true,
          },
        },
        sessionToken: 'session-token',
        csrfToken: 'csrf-token',
      }
    })
    const request = new Request(
      'https://preview.example/.netlify/functions/identity-workspace?route=/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://preview.example' },
        body: JSON.stringify({ email: 'admin@example.invalid', password: 'long password' }),
      },
    )

    const response = await handler(request)
    const cookies = response.headers.getSetCookie()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      user: {
        id: 'user-1',
        email: 'admin@example.invalid',
        displayName: 'Preview Admin',
        isOrganizationAdmin: true,
      },
    })
    expect(cookies).toContainEqual(
      expect.stringMatching(/^arc_one_session=session-token;.*Max-Age=604800;.*Path=\/;.*HttpOnly;.*Secure;.*SameSite=Lax$/),
    )
    expect(cookies).toContainEqual(
      expect.stringMatching(/^arc_one_csrf=csrf-token;.*Max-Age=604800;.*Path=\/;.*Secure;.*SameSite=Lax$/),
    )
  })

  it('rejects cross-origin login before calling the backend', async () => {
    let called = false
    const handler = createIdentityWorkspaceHandler(async () => {
      called = true
      throw new Error('must not run')
    })
    const response = await handler(
      new Request(
        'https://preview.example/.netlify/functions/identity-workspace?route=/api/auth/login',
        {
          method: 'POST',
          headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@example.invalid', password: 'long password' }),
        },
      ),
    )

    expect(called).toBe(false)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ detail: 'Origin 校验失败' })
  })

  it('maps domain errors and clears stale authentication cookies on 401', async () => {
    const handler = createIdentityWorkspaceHandler(async () => {
      throw new ApiError(401, '未登录或会话已失效', true)
    })
    const response = await handler(
      new Request(
        'https://preview.example/.netlify/functions/identity-workspace?route=/api/auth/session',
      ),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ detail: '未登录或会话已失效' })
    expect(response.headers.getSetCookie()).toHaveLength(2)
    expect(response.headers.getSetCookie().every((cookie) => cookie.includes('Max-Age=0'))).toBe(true)
  })

  it('returns 404 for a direct function call without a whitelisted route', async () => {
    const handler = createIdentityWorkspaceHandler(async () => {
      throw new Error('must not run')
    })
    const response = await handler(
      new Request('https://preview.example/.netlify/functions/identity-workspace'),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ detail: 'Not Found' })
  })

  it('accepts the original API path retained by a Netlify rewrite', async () => {
    const handler = createIdentityWorkspaceHandler(async ({ route }) => ({
      body: { route: route.name },
    }))
    const response = await handler(new Request('https://preview.example/api/auth/session'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ route: 'auth.session' })
  })
})

describe('Netlify identity/workspace transaction failure semantics', () => {
  it('commits the fifth failed-login counter before returning account locked', async () => {
    const queries = []
    const client = {
      async query(text) {
        queries.push(text.trim())
        if (text.includes('SELECT u.* FROM users')) {
          return {
            rows: [{
              id: 'user-1', organization_id: 'org-1', email: 'admin@example.invalid',
              normalized_email: 'admin@example.invalid', display_name: 'Admin',
              password_hash: '$argon2id$v=19$m=65536,t=3,p=4$aDyKH1F/wTEq5XGUlnqKUw$XuDAaTrn2LTNBU6GQ9FGKxkTRNTUpUeZZQWFMDQV/Ks',
              status: 'active', is_organization_admin: true, failed_login_count: 4,
              locked_until: null, password_changed_at: null, last_login_at: null,
            }],
            rowCount: 1,
          }
        }
        return { rows: [], rowCount: 1 }
      },
      release() {},
    }
    const backend = createPostgresIdentityWorkspaceBackend({ async connect() { return client } })

    await expect(backend({
      route: { name: 'auth.login', params: {} },
      request: new Request('https://preview.example/api/auth/login', { method: 'POST' }),
      body: { email: 'admin@example.invalid', password: 'Wrong Password 42!' },
      sessionToken: null,
      csrfToken: null,
      clientAddress: '192.0.2.1',
    })).rejects.toMatchObject({ status: 429, message: '邮箱或密码错误', commitOnError: true })

    expect(queries.at(-1)).toBe('COMMIT')
    expect(queries.some((query) => query.startsWith('UPDATE users'))).toBe(true)
    expect(queries).not.toContain('ROLLBACK')
  })

  it('rolls back validation failures that have no durable security side effect', async () => {
    const queries = []
    const client = {
      async query(text) {
        queries.push(text.trim())
        return { rows: [], rowCount: 0 }
      },
      release() {},
    }
    const backend = createPostgresIdentityWorkspaceBackend({ async connect() { return client } })

    await expect(backend({
      route: { name: 'auth.login', params: {} },
      request: new Request('https://preview.example/api/auth/login', { method: 'POST' }),
      body: { email: 'x', password: 'short' },
      sessionToken: null,
      csrfToken: null,
      clientAddress: null,
    })).rejects.toMatchObject({ status: 422 })

    expect(queries).toEqual(['BEGIN', 'ROLLBACK'])
  })
})
