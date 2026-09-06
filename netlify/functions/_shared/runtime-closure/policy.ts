import { ApiError } from '../identity-workspace/handler.ts'
export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function text(v: unknown, max = 4000): string { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new ApiError(422, '字段格式不符合要求'); return v.trim() }
export type Decision = { decision: string; reason: string; artifactVersionId: string; idempotencyKey: string; modifiedContent: string | null; tags: string[] }
/** Validate the entire retry body, not only decision kind. */
export function parseDecision(v: unknown): Decision {
  if (!object(v) || Object.keys(v).some(k => !['decision','reason','artifactVersionId','idempotencyKey','modifiedContent','tags'].includes(k))) throw new ApiError(422, '审核请求不符合要求')
  if (!['approve','reject','modify_and_approve','return_for_rerun'].includes(String(v.decision))) throw new ApiError(422, '审核决定无效')
  const tags = v.tags ?? []
  if (!Array.isArray(tags) || tags.length > 30) throw new ApiError(422, '标签无效')
  return { decision: String(v.decision), reason:text(v.reason), artifactVersionId:text(v.artifactVersionId,36), idempotencyKey:text(v.idempotencyKey,160),
    modifiedContent:v.decision === 'modify_and_approve' ? text(v.modifiedContent,20000) : v.modifiedContent == null ? null : text(v.modifiedContent,20000), tags:tags.map(x=>text(x,80)) }
}
/** Distinct eligible participant votes determine a countersign outcome. */
export function approvalOutcome(policy: string, required: number, participants: string[], decisions: {reviewer_id:string;decision:string}[]): string {
  if (!['any_one','all','threshold'].includes(policy) || !participants.length || required < 1 || required > participants.length) throw new ApiError(409, '审核策略需要治理')
  const eligible = decisions.filter(d=>participants.includes(d.reviewer_id))
  const terminal = eligible.find(d=>['reject','return_for_rerun'].includes(d.decision))
  if (terminal) return terminal.decision
  const count = new Set(eligible.filter(d=>['approve','modify_and_approve'].includes(d.decision)).map(d=>d.reviewer_id)).size
  return count >= (policy === 'any_one' ? 1 : policy === 'all' ? participants.length : required) ? 'approve' : 'pending'
}
/** Recompute weights server-side; malformed or incomplete judge output cannot pass. */
export function normalizeJudgeResult(snapshot: Record<string, unknown>, raw: unknown) {
  if (!object(raw) || !Array.isArray(raw.dimensionScores) || !Array.isArray(snapshot.dimensions) || raw.dimensionScores.length !== snapshot.dimensions.length) throw new ApiError(502, '评分响应维度不完整')
  const dimensions = snapshot.dimensions as {id?:string;name:string;weight:number}[]
  if (!dimensions.length || dimensions.reduce((s,d)=>s+d.weight,0)!==100) throw new ApiError(409,'固定量规权重无效')
  const dimensionScores = dimensions.map(d=> {
    const matches = (raw.dimensionScores as unknown[]).filter(x=>object(x) && (d.id ? x.dimensionId===d.id : x.name===d.name))
    const result = matches[0]
    if (matches.length!==1 || !object(result) || !Number.isInteger(result.score) || Number(result.score)<0 || Number(result.score)>100) throw new ApiError(502,'评分响应分数无效')
    return { ...(d.id ? {dimensionId:d.id}:{}), name:d.name,weight:d.weight,score:Number(result.score),weightedScore:Number(result.score)*d.weight/100,reason:text(result.reason) }
  })
  const score = roundEven(dimensionScores.reduce((s,d)=>s+d.weightedScore,0))
  return {dimensionScores,score,status:score>=Number(snapshot.passScore)?'passed':'failed',rationale:text(raw.rationale)}
}
export function roundEven(value:number) {const floor=Math.floor(value),part=value-floor;return part===0.5?floor%2===0?floor:floor+1:Math.round(value)}
/** Project persistent snake case fields without inventing trace relationships. */
export function project(row: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(row).filter(([k])=>!['workspace_id','request_body'].includes(k)).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),v instanceof Date?v.toISOString():v])) }
/** Existing V1 Lite object schema contract; not a full JSON Schema implementation. */
export function validateArtifact(content:string,snapshot:unknown) {
 const schema=object(snapshot)?snapshot.schema:null
 if(!object(schema)||schema.type!=='object')return{status:'unchecked',label:'未校验',reasons:['未绑定可校验的对象 Schema']}
 let data:unknown;try{data=JSON.parse(content)}catch{data=null}
 if(!object(data))return{status:'failed',label:'Schema 校验失败',reasons:['内容不是合法 JSON 对象']}
 const reasons:string[]=[]
 if(Array.isArray(schema.required))for(const field of schema.required)if(typeof field==='string'&&!Object.hasOwn(data,field))reasons.push(`缺少必填字段：${field}`)
 if(object(schema.properties))for(const[field,def]of Object.entries(schema.properties)) {
  if(!Object.hasOwn(data,field)||!object(def)||typeof def.type!=='string')continue
  const value=data[field],valid=def.type==='object'?object(value):def.type==='integer'?Number.isInteger(value):def.type==='number'?typeof value==='number':!['string','boolean'].includes(def.type)||typeof value===def.type
  if(!valid)reasons.push(`字段 ${field} 类型应为 ${def.type}`)
 }
 return{status:reasons.length?'failed':'passed',label:reasons.length?'Schema 校验失败':'Schema 校验通过',reasons}
}
