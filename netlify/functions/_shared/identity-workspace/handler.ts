import type { IdentityWorkspaceRouteName } from './routes.ts'
import { resolveIdentityWorkspaceRoute } from './routes.ts'

const SESSION_COOKIE = 'arc_one_session'
const CSRF_COOKIE = 'arc_one_csrf'
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60

export type ResolvedRoute = NonNullable<ReturnType<typeof resolveIdentityWorkspaceRoute>>

export type BackendInput = {
  route: ResolvedRoute
  request: Request
  body: unknown
  sessionToken: string | null
  csrfToken: string | null
  clientAddress: string | null
}

export type BackendResult = {
  status?: number
  body?: unknown
  sessionToken?: string
  csrfToken?: string
  clearAuthCookies?: boolean
}

export type IdentityWorkspaceBackend = (input: BackendInput) => Promise<BackendResult>

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly clearAuthCookies = false,
    readonly commitOnError = false,
  ) {
    super(message)
  }
}

type HandlerOptions = {
  allowedOrigins?: readonly string[]
}

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

export function createIdentityWorkspaceHandler(
  backend: IdentityWorkspaceBackend,
  options: HandlerOptions = {},
) {
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? []).map((origin) => origin.replace(/\/$/, '')),
  )

  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const route = resolveIdentityWorkspaceRoute(request.method, url.pathname)
      if (!route) throw new ApiError(404, 'Not Found')

      if (requiresSameOrigin(route.name)) {
        requireSameOrigin(request, allowedOrigins)
      }

      const body = await readBody(request)
      const cookies = parseCookies(request.headers.get('cookie'))
      const result = await backend({
        route,
        request,
        body,
        sessionToken: cookies.get(SESSION_COOKIE) ?? null,
        csrfToken: request.headers.get('X-CSRF-Token'),
        clientAddress: request.headers.get('x-nf-client-connection-ip'),
      })
      const headers = new Headers(responseHeaders)
      if (result.sessionToken && result.csrfToken) {
        setAuthCookies(headers, result.sessionToken, result.csrfToken)
      }
      if (result.clearAuthCookies) clearAuthCookies(headers)
      const status = result.status ?? 200
      return new Response(status === 204 ? null : JSON.stringify(result.body ?? null), {
        status,
        headers,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        const headers = new Headers(responseHeaders)
        if (error.clearAuthCookies) clearAuthCookies(headers)
        return Response.json(
          { detail: error.message },
          { status: error.status, headers },
        )
      }
      return Response.json(
        { detail: '服务暂时不可用' },
        { status: 503, headers: responseHeaders },
      )
    }
  }
}

function requiresSameOrigin(name: IdentityWorkspaceRouteName): boolean {
  return name === 'auth.login' || name.startsWith('invitation.')
}

function requireSameOrigin(request: Request, allowedOrigins: ReadonlySet<string>): void {
  const origin = request.headers.get('origin')
  if (!origin) return
  const normalized = origin.replace(/\/$/, '')
  if (normalized !== new URL(request.url).origin && !allowedOrigins.has(normalized)) {
    throw new ApiError(403, 'Origin 校验失败')
  }
}

async function readBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return null
  const text = await request.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError(422, '请求正文不是有效 JSON')
  }
}

function parseCookies(header: string | null): Map<string, string> {
  const values = new Map<string, string>()
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    values.set(part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim()))
  }
  return values
}

function setAuthCookies(headers: Headers, sessionToken: string, csrfToken: string): void {
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  )
  headers.append(
    'Set-Cookie',
    `${CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; Secure; SameSite=Lax`,
  )
}

function clearAuthCookies(headers: Headers): void {
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
  )
  headers.append(
    'Set-Cookie',
    `${CSRF_COOKIE}=; Max-Age=0; Path=/; Secure; SameSite=Lax`,
  )
}
