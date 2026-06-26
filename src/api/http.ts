export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let didDispatchSessionExpired = false

function readCookie(name: string): string | null {
  const prefix = `${name}=`
  const value = document.cookie
    .split('; ')
    .find((item) => item.startsWith(prefix))
  if (!value) return null
  return decodeURIComponent(value.slice(prefix.length))
}

function getRequestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return `${input.pathname}${input.search}`
  return input.url
}

function shouldAttachCsrfToken(method: string) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method)
}

function shouldDispatchSessionExpired(path: string, status: number) {
  if (status !== 401) return false
  if (!path.startsWith('/api/')) return false
  return !path.startsWith('/api/auth/login')
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  const csrfToken = readCookie('arc_one_csrf')
  if (csrfToken && shouldAttachCsrfToken(method)) {
    headers.set('X-CSRF-Token', csrfToken)
  }
  const response = await fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers,
  })
  const path = getRequestPath(input)
  if (shouldDispatchSessionExpired(path, response.status)) {
    if (!didDispatchSessionExpired) {
      didDispatchSessionExpired = true
      window.dispatchEvent(new CustomEvent('auth-session-expired'))
    }
  } else {
    didDispatchSessionExpired = false
  }
  return response
}

export async function readJson<T>(response: Response): Promise<T> {
  let data: T | { detail?: string | string[] }
  try {
    data = await response.json() as T | { detail?: string | string[] }
  } catch {
    if (!response.ok) {
      const message = response.status >= 500
        ? '服务暂时不可用，请稍后重试'
        : '请求失败'
      throw new ApiError(response.status, message)
    }
    throw new ApiError(response.status, '服务响应格式异常')
  }
  if (!response.ok) {
    const detail = 'detail' in (data as object)
      ? (data as { detail?: string | string[] }).detail
      : undefined
    const message = Array.isArray(detail) ? detail.join('；') : detail ?? '请求失败'
    throw new ApiError(response.status, message)
  }
  return data as T
}
