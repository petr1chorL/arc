import { ApiError } from '../identity-workspace/handler.ts'

export type DataObjectFields = { name: string; description: string; object_schema: Record<string, unknown> }
const invalid = () => new ApiError(422, 'Data Object 请求字段不符合要求')

/** Preserve Python's extra=forbid and alias semantics for JSON requests. */
function parseFields(value: unknown, partial: boolean): Partial<DataObjectFields> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !['name', 'description', 'schema', 'object_schema'].includes(key))
    || (Object.hasOwn(body, 'schema') && Object.hasOwn(body, 'object_schema'))) throw invalid()
  const result: Partial<DataObjectFields> = {}
  for (const key of ['name', 'description', 'object_schema'] as const) {
    const source = key === 'object_schema' && Object.hasOwn(body, 'schema') ? 'schema' : key
    const present = Object.hasOwn(body, source)
    const field = body[source]
    if (partial && (!present || field === null)) continue
    if (!present && key === 'description') { result.description = ''; continue }
    if (key === 'object_schema') {
      if (!field || typeof field !== 'object' || Array.isArray(field)) throw invalid()
      result.object_schema = field as Record<string, unknown>
    } else {
      if (typeof field !== 'string' || Array.from(field).length > (key === 'name' ? 120 : 2000)
        || (key === 'name' && !field.trim())) throw invalid()
      result[key] = key === 'name' ? field.trim() : field
    }
  }
  return result
}

export function parseDataObjectCreate(value: unknown): DataObjectFields {
  return parseFields(value, false) as DataObjectFields
}

export function parseDataObjectUpdate(value: unknown): Partial<DataObjectFields> {
  return parseFields(value, true)
}
