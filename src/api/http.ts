export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function apiUrl(path: string): string {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
  if (!apiBaseUrl) {
    return path
  }
  return `${apiBaseUrl.replace(/\/$/, '')}${path}`
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (init === undefined) {
    return fetch(apiUrl(path))
  }
  return fetch(apiUrl(path), init)
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
