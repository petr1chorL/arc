import { getDatabase } from '@netlify/database'
import type { Context } from '@netlify/functions'
import type { SqlPool } from './_shared/identity-workspace/postgres.ts'
import { createReferenceAssetsHandler } from './_shared/reference-assets/handler.ts'
import { createPostgresReferenceAssetsBackend } from './_shared/reference-assets/postgres.ts'
import { resolveReferenceAssetRoute } from './_shared/reference-assets/routes.ts'

// No public path config or production redirect: direct function URLs remain dormant.
export default async (request: Request, context: Context): Promise<Response> => {
  if (!resolveReferenceAssetRoute(request.method, new URL(request.url).pathname)) {
    return Response.json({ detail: '接口不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  const backend = createPostgresReferenceAssetsBackend({
    async connect() {
      return getDatabase().pool.connect() as unknown as Awaited<ReturnType<SqlPool['connect']>>
    },
  })
  return createReferenceAssetsHandler(backend, {
    clientAddress: context.ip,
    allowedOrigins: (Netlify.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean),
  })(request)
}
