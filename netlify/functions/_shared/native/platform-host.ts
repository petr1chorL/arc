import type { SqlPool } from '../identity-workspace/postgres.ts'
import type { Context } from '@netlify/functions'
import { createNativeApiHost } from './api-host.ts'
import { isNativeDeploymentEnabled } from './deployment.ts'
import { createNativeRuntimeDependencies } from './runtime-dependencies.ts'
import { createRuntimeWorkload, tickRuntime, type RuntimeSender } from '../runtime/netlify.ts'

export type NativePlatformPorts = {
  readEnv: (name: string) => string | undefined
  loadPool: () => SqlPool | Promise<SqlPool>
  initializeIdentity: (pool: SqlPool, options: { enabled: boolean; loadConfig: () => unknown }) => Promise<unknown>
  createSender: () => RuntimeSender
}

const disabled = () => Response.json({ detail: '原生运行模式未启用' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
const unavailable = () => Response.json({ detail: '服务暂时不可用' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })

/** Rewrite the transitional prefix without changing method, body, origin, query or credentials. */
export function normalizeNativeRequest(request: Request): Request {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/native-api/')) return request
  url.pathname = `/api/${url.pathname.slice('/native-api/'.length)}`
  return new Request(url, request)
}

/** The platform mode is the only setting accessed by dormant entrypoints. */
export function createNativePlatformHost(ports: NativePlatformPorts) {
  const runtimePorts = (mode: string) => ({ mode,
    loadConfig: () => JSON.parse(ports.readEnv('ARC_NATIVE_RUNTIME_CONFIG') ?? '{"bindings":[]}'),
    resolveSecret: (ref: string) => ports.readEnv(ref),
    loadAcceptancePool: () => ports.loadPool(),
  })
  const lazySender = (): RuntimeSender => {
    let send: RuntimeSender | undefined
    return async id => {
      try { send ??= ports.createSender(); return await send(id) }
      catch { return { sendStatus: 'failed' } }
    }
  }
  return {
    async api(request: Request, context: Pick<Context, 'ip'>): Promise<Response> {
      try {
        const mode = ports.readEnv('ARC_NATIVE_MODE')
        if (!isNativeDeploymentEnabled(mode)) return disabled()
        return await createNativeApiHost({ ...runtimePorts(mode!),
          loadPool: async () => {
            const pool = await ports.loadPool()
            await ports.initializeIdentity(pool, { enabled: ports.readEnv('ARC_FRESH_START') === 'enabled',
              loadConfig: () => ({ email: ports.readEnv('ARC_INITIAL_ADMIN_EMAIL'), password: ports.readEnv('ARC_INITIAL_ADMIN_PASSWORD') }),
            })
            return await requireInitializedPool(pool)
          },
        })(normalizeNativeRequest(request), { clientAddress: context.ip })
      } catch { return unavailable() }
    },
    async workload(request: Request, context: Context): Promise<Response | void> {
      try {
        const mode = ports.readEnv('ARC_NATIVE_MODE')
        if (!isNativeDeploymentEnabled(mode)) return disabled()
        const assembly = createNativeRuntimeDependencies(runtimePorts(mode!))!
        // No connection or sender is created until the SDK has authenticated the event.
        const workload = createRuntimeWorkload(createInitializedRuntimePool(() => ports.loadPool()), assembly.dependencies, lazySender())
        // SDK 0.0.106 carries old Context types (required flags); its wrapper does not read context.
        return await workload(request, context as unknown as Parameters<typeof workload>[1])
      } catch { return unavailable() }
    },
    async scheduled(): Promise<Response> {
      try {
        const mode = ports.readEnv('ARC_NATIVE_MODE')
        if (!isNativeDeploymentEnabled(mode)) return disabled()
        // Reject malformed bindings even though tick only creates intents, never executes models.
        createNativeRuntimeDependencies(runtimePorts(mode!))
        const result = await tickRuntime(createInitializedRuntimePool(() => ports.loadPool()), lazySender())
        return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
      } catch { return unavailable() }
    },
  }
}

/** Internal consumer/tick port: the first connection verifies readiness before lending business access. */
export function createInitializedRuntimePool(load: NativePlatformPorts['loadPool']): SqlPool {
  let pending: Promise<SqlPool> | undefined
  return { async connect() {
    try {
      pending ??= Promise.resolve().then(load).then(requireInitializedPool)
      const client = await (await pending).connect()
      return { async query<Row extends Record<string, unknown>>(text: string, values?: unknown[]) {
        try { return await client.query<Row>(text, values) }
        catch { throw new Error('运行存储暂时不可用') }
      }, release: () => client.release() }
    } catch { throw new Error('运行存储暂时不可用') }
  } }
}

async function requireInitializedPool(pool: SqlPool): Promise<SqlPool> {
  const client = await pool.connect()
  try {
    const marker = await client.query("SELECT id FROM native_bootstrap_state WHERE id='arc-one'")
    if (!marker.rows.length) throw new Error('原生身份尚未初始化')
    return pool
  } finally { client.release() }
}
