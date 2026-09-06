export type RuntimeDeliveryRoute = {
  operation: string
  params: { workspaceId: string; id?: string }
}

/** Only registered delivery routes; all path segments are decoded exactly once. */
export function resolveRuntimeDeliveryRoute(method: string, path: string): RuntimeDeliveryRoute | null {
  let parts: string[]
  try { parts = path.split('/').map(decodeURIComponent) } catch { return null }
  if (parts.some(part => Array.from(part).some(char => char==='/' || char==='\\' || char.charCodeAt(0)<32 || char.charCodeAt(0)===127)) || parts[0] !== '' || parts[1] !== 'api' || parts[2] !== 'workspaces' || !parts[3]) return null
  const [resource, id, action, extra] = parts.slice(4), verb = method.toUpperCase()
  let operation: string | undefined, target = id
  if (resource === 'schedules' && !extra) {
    if (!id && parts.length === 5) operation = verb === 'GET' ? 'schedule-list' : verb === 'POST' ? 'schedule-create' : undefined
    else if (id && !action && parts.length === 6 && verb === 'PATCH') operation = 'schedule-update'
    else if (id && parts.length === 7 && (verb === 'GET' && action === 'dispatches' || verb === 'POST' && ['pause','resume','trigger'].includes(action))) operation = `schedule-${action}`
  } else if (resource === 'notification-channels' && !extra) {
    if (!id && parts.length === 5) operation = verb === 'GET' ? 'channel-list' : verb === 'POST' ? 'channel-create' : undefined
    else if (id && parts.length === 7 && verb === 'POST' && ['disable','enable'].includes(action)) operation = `channel-${action}`
  } else if (resource === 'notifications' && id === 'outbox') {
    target = action
    if (parts.length === 6 && verb === 'GET') operation = 'outbox-list'
    else if (parts.length === 7 && action === 'dispatch' && verb === 'POST') operation = 'outbox-dispatch'
    else if (parts.length === 8 && action && extra === 'requeue' && verb === 'POST') operation = 'outbox-requeue'
  }
  return operation ? { operation, params: { workspaceId: parts[3], ...(target ? {id:target} : {}) } } : null
}
