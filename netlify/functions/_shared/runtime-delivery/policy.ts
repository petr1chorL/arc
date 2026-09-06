import cronParser from 'cron-parser'
import { ApiError } from '../identity-workspace/handler.ts'

/** Five-field cron, IANA timezone, strictly after the supplied instant (no catch-up). */
export function nextScheduleTime(expression: string, timezone: string, after: Date): Date {
  try {
    if (expression.trim().split(/\s+/).length !== 5 || !Number.isFinite(after.getTime())) throw new Error()
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(after)
    const parsed=cronParser.parseExpression(expression, { currentDate: after, tz: timezone }), next=parsed.next().toDate()
    // croniter collapses a nonexistent spring-forward wall time to the start of
    // the valid interval; cron-parser retains the minute. Keep the legacy contract.
    const format=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    const civil=(date:Date)=>Object.fromEntries(format.formatToParts(date).map(part=>[part.type,Number(part.value)]))
    const local=civil(next)
    if (!parsed.fields.hour.some(value=>value===local.hour) || !parsed.fields.minute.some(value=>value===local.minute)) {
      const offset=(date:Date)=>{const parts=civil(date);return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute)-date.getTime()}
      const currentOffset=offset(next)
      for(let minutes=1;minutes<=180;minutes++) {
        const before=new Date(next.getTime()-minutes*60000)
        if(offset(before)<currentOffset) {
          const transition=new Date(before.getTime()+60000)
          if(transition>after)return transition
          break
        }
      }
    }
    return next
  } catch { throw new ApiError(422, 'Cron 表达式或 IANA 时区无效') }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(422, '请求正文必须是对象')
  return value as Record<string, unknown>
}

export function text(value: unknown, field: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new ApiError(422, `${field} 字段无效`)
  return value.trim()
}

export function parseSchedule(value: unknown, partial = false) {
  const body = object(value), result: Record<string, unknown> = {}
  const fields = { name: 160, workflowId: 36, workflowVersion: 20, cronExpression: 120, timezone: 120, input: 50000 }
  if (Object.keys(body).some(key => !(key in fields) && (key !== 'status' || partial))) throw new ApiError(422, '未知调度字段')
  for (const [key, max] of Object.entries(fields)) {
    if (partial && !Object.hasOwn(body, key)) continue
    result[key] = text(body[key] ?? (!partial && key === 'timezone' ? 'UTC' : !partial && key === 'input' ? '{}' : undefined), key, max)
  }
  if ('input' in result) {
    try { JSON.parse(String(result.input)) }
    catch { throw new ApiError(422, '调度输入必须是合法 JSON') }
  }
  if (!partial) {
    if (body.status !== undefined && !['active', 'paused'].includes(String(body.status))) throw new ApiError(422, '调度状态无效')
    result.status = body.status ?? 'active'
  }
  return result
}

export function parseChannel(value: unknown) {
  const body = object(value)
  if (Object.keys(body).some(key => !['name', 'channelType', 'config', 'secretRef'].includes(key))) throw new ApiError(422, '未知通知字段')
  const name = text(body.name, 'name', 120), channelType = text(body.channelType, 'channelType', 32)
  if (!['in_app', 'email', 'webhook', 'feishu'].includes(channelType)) throw new ApiError(422, '通知渠道类型无效')
  const config = object(body.config ?? {}), secretRef = text(body.secretRef ?? '', 'secretRef', 160, true)
  if (secretRef && !/^[A-Z][A-Z0-9_]*$/.test(secretRef)) throw new ApiError(422, 'Secret Ref 必须是环境变量名称')
  if (JSON.stringify(config).length > 10000 || containsCredential(config)) throw new ApiError(422, '通知配置不得包含凭证')
  return { name, channelType, config, secretRef }
}

function containsCredential(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, item]) => /token|password|secret|authorization|api.?key/i.test(key) || containsCredential(item))
}

export function limitParam(url: URL, fallback: number, maximum: number): number {
  const value = url.searchParams.get('limit')
  if (value === null) return fallback
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum) throw new ApiError(422, 'limit 无效')
  return Number(value)
}
