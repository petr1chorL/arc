import { getDatabase } from '@netlify/database'

import { createIdentityWorkspaceHandler } from './_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend, type SqlPool } from './_shared/identity-workspace/postgres.ts'

function allowedOrigins(): string[] {
  return (Netlify.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export default async (request: Request): Promise<Response> => {
  const backend = createPostgresIdentityWorkspaceBackend({
    async connect() {
      const database = getDatabase()
      return database.pool.connect() as unknown as Awaited<ReturnType<SqlPool['connect']>>
    },
  })
  return createIdentityWorkspaceHandler(backend, { allowedOrigins: allowedOrigins() })(request)
}
