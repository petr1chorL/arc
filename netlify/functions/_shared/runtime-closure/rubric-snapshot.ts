import { ApiError } from '../identity-workspace/handler.ts'
import { object } from './policy.ts'

const invalid = () => new ApiError(409, '固定量规快照字段无效或冲突')
const aliases = { judge_type: 'judgeType', judge_model: 'judgeModel', model_provider_id: 'modelProviderId', pass_score: 'passScore' } as const

/** Read both immutable storage formats without rewriting history or guessing the judge mode. */
export function normalizeRuntimeRubricSnapshot(value: unknown): Record<string, unknown> {
  if (!object(value)) throw invalid()
  const result = { ...value }
  for (const [stored, canonical] of Object.entries(aliases)) {
    if (Object.hasOwn(value, stored)) {
      if (Object.hasOwn(value, canonical) && value[stored] !== value[canonical]) throw invalid()
      result[canonical] = value[stored]
      delete result[stored]
    }
  }
  if ((result.judgeType !== 'llm' && result.judgeType !== 'deterministic')
    || typeof result.passScore !== 'number' || !Number.isInteger(result.passScore) || result.passScore < 0 || result.passScore > 100
    || !Array.isArray(result.dimensions) || !result.dimensions.length) throw invalid()
  if (result.judgeType === 'llm' && (typeof result.judgeModel !== 'string' || !result.judgeModel.trim() || result.judgeModel.length > 120
    || typeof result.modelProviderId !== 'string' || !result.modelProviderId.trim() || result.modelProviderId.length > 36)) throw invalid()
  return result
}
