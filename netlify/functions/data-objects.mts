import { getDatabase } from '@netlify/database'
import type { Context } from '@netlify/functions'
import type { SqlPool } from './_shared/identity-workspace/postgres.ts'
import { createDataObjectsHandler } from './_shared/data-objects/handler.ts'
import { createPostgresDataObjectsBackend } from './_shared/data-objects/postgres.ts'
import { resolveDataObjectRoute } from './_shared/data-objects/routes.ts'

// Deliberately no public path config until migration acceptance and cutover.
export default async (request: Request, context: Context): Promise<Response> => {
  if (!resolveDataObjectRoute(request.method, new URL(request.url).pathname)) {
    return Response.json({ detail: '接口不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  const backend = createPostgresDataObjectsBackend({
    async connect() {
      return getDatabase().pool.connect() as unknown as Awaited<ReturnType<SqlPool['connect']>>
    },
  })
  return createDataObjectsHandler(backend, {
    clientAddress: context.ip,
    allowedOrigins: (Netlify.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean),
  })(request)
}
