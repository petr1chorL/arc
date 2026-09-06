import type { HandlerOptions } from '../identity-workspace/handler.ts'
import type { SqlPool } from '../identity-workspace/postgres.ts'
import { createNativeApiRouter, type NativeApiBackendOptions } from './router.ts'

export type NativeDeploymentOptions = {
  mode?: string
  loadPool: () => SqlPool | Promise<SqlPool>
  loadBackendOptions?: () => NativeApiBackendOptions | Promise<NativeApiBackendOptions>
}

/** Only the exact server-side cutover mode enables native API, consumer and tick entrypoints. */
export function isNativeDeploymentEnabled(mode: unknown): boolean {
  return mode === 'runtime'
}

/** Lazy deployment boundary. The host supplies trusted client metadata per request. */
export function createNativeApiDeployment(deployment: NativeDeploymentOptions) {
  return async (request: Request, options: HandlerOptions): Promise<Response> => {
    if (!isNativeDeploymentEnabled(deployment.mode)) {
      return Response.json({ detail: '接口不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }
    try {
      const backendOptions = await deployment.loadBackendOptions?.()
      return await createNativeApiRouter(await deployment.loadPool(), options, backendOptions)(request)
    } catch {
      return Response.json({ detail: '服务暂时不可用' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
  }
}
