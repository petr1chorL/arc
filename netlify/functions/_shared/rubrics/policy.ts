import { ApiError } from '../identity-workspace/handler.ts'
import { casefold } from './casefold.ts'

export type RubricDimension = { id: string | null; name: string; weight: number; criteria: string | null }
export type RubricFields = {
  name: string; artifact: string; gate: string; pass_score: number; dimensions: RubricDimension[]
  judge_type: 'deterministic' | 'llm'; judge_model: string; model_provider_id: string | null
}
const invalid = () => new ApiError(422, '量规或样本请求字段不符合要求')
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
// Python str.strip includes NEL/control separators but does not strip the BOM.
// eslint-disable-next-line no-control-regex -- Required by the existing Python text contract, not arbitrary control acceptance.
export const strip = (value: string) => value.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '')

function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || Array.from(value).length > max) throw invalid()
  const normalized = strip(value)
  if (required && !normalized) throw invalid()
  return normalized
}

function integer(value: unknown, min: number): number {
  let number: unknown = value
  if (typeof value === 'boolean') number = Number(value)
  if (typeof value === 'string') {
    // Pydantic's integer parser uses Unicode whitespace, unlike Python's broader str.strip.
    const normalized = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
    if (!/^[+-]?[0-9](?:_?[0-9])*(?:\.0+)?$/.test(normalized)) throw invalid()
    number = Number(normalized.replaceAll('_', ''))
  }
  if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > 100) throw invalid()
  return number === 0 ? 0 : number
}

function dimension(value: unknown): RubricDimension {
  if (!object(value)) throw invalid()
  // RubricDimensionWrite preserves Pydantic's nested extra=ignore default.
  return { id: value.id == null ? null : text(value.id, 80, true), name: text(value.name, 80, true),
    weight: integer(value.weight, 1), criteria: value.criteria == null ? null : text(value.criteria, 4000) }
}

/** Parse the same full write body for rubric creation and replacement. */
export function parseRubricWrite(value: unknown): RubricFields {
  if (!object(value)) throw invalid()
  const aliases = { pass_score: 'passScore', judge_type: 'judgeType', judge_model: 'judgeModel', model_provider_id: 'modelProviderId' }
  const body = { ...value }
  for (const [key, alias] of Object.entries(aliases)) {
    if (Object.hasOwn(body, key) && Object.hasOwn(body, alias)) throw invalid()
    if (Object.hasOwn(body, alias)) { body[key] = body[alias]; delete body[alias] }
  }
  if (Object.keys(body).some(key => !['name', 'artifact', 'gate', 'dimensions', ...Object.keys(aliases)].includes(key))) throw invalid()
  if (!Array.isArray(body.dimensions) || !body.dimensions.length) throw invalid()
  const dimensions = body.dimensions.map(dimension)
  if (dimensions.reduce((sum, item) => sum + item.weight, 0) !== 100) throw invalid()
  for (const values of [dimensions.map(item => item.name), dimensions.flatMap(item => item.id === null ? [] : [item.id])]) {
    if (new Set(values.map(casefold)).size !== values.length) throw invalid()
  }
  const judgeType = Object.hasOwn(body, 'judge_type') ? body.judge_type : 'deterministic'
  if (judgeType !== 'deterministic' && judgeType !== 'llm') throw invalid()
  return { name: text(body.name, 160, true), artifact: text(body.artifact, 160, true), gate: text(body.gate, 4000, true),
    pass_score: integer(body.pass_score, 0), dimensions, judge_type: judgeType,
    judge_model: text(Object.hasOwn(body, 'judge_model') ? body.judge_model : '', 120),
    model_provider_id: body.model_provider_id == null ? null : text(body.model_provider_id, 36) || null }
}
