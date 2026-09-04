import { getDatabase } from '@netlify/database'

import { createPlatformHealthHandler } from './_shared/platform-health.ts'

async function checkDatabase(): Promise<void> {
  const database = getDatabase()
  const rows = await database.sql`SELECT 1 AS ready`
  if (rows[0]?.ready !== 1) {
    throw new Error('Database readiness query failed')
  }
}

export default async (request: Request): Promise<Response> => {
  return createPlatformHealthHandler(checkDatabase)(request)
}
