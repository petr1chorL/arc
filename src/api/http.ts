export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json() as T | { detail?: string | string[] }
  if (!response.ok) {
    const detail = 'detail' in (data as object)
      ? (data as { detail?: string | string[] }).detail
      : undefined
    const message = Array.isArray(detail) ? detail.join('；') : detail ?? '请求失败'
    throw new ApiError(response.status, message)
  }
  return data as T
}
