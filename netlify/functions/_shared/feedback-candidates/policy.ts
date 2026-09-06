import { ApiError } from '../identity-workspace/handler.ts'

/** Preserve the existing expert-confirmation body; sample content is never supplied here. */
export function parseGoldenSampleConfirm(value: unknown): { reason: string; idempotency_key: string } {
  const invalid = () => new ApiError(422, '量规或样本请求字段不符合要求')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !['reason', 'idempotencyKey', 'idempotency_key'].includes(key))
    || (Object.hasOwn(body, 'idempotencyKey') && Object.hasOwn(body, 'idempotency_key'))) throw invalid()
  const key = Object.hasOwn(body, 'idempotencyKey') ? body.idempotencyKey : body.idempotency_key
  if (typeof body.reason !== 'string' || typeof key !== 'string'
    || Array.from(body.reason).length < 1 || Array.from(body.reason).length > 4000
    || Array.from(key).length < 1 || Array.from(key).length > 160) throw invalid()
  return { reason: body.reason, idempotency_key: key }
}
