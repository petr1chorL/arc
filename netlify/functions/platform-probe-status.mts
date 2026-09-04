import { getDatabase } from '@netlify/database'

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') {
    return Response.json(
      { status: 'method-not-allowed' },
      { status: 405, headers: { ...responseHeaders, Allow: 'GET' } },
    )
  }

  try {
    const database = getDatabase()
    const dispatches = await database.sql`
      SELECT suite_id, status, created_at, updated_at
      FROM netlify_platform_probe_dispatches
      ORDER BY created_at DESC
      LIMIT 5
    `
    const operations = await database.sql`
      SELECT operation_id, status, attempt_count, created_at, completed_at
      FROM netlify_platform_probe_events
      ORDER BY created_at DESC
      LIMIT 10
    `
    return Response.json(
      { status: 'ok', dispatches, operations },
      { status: 200, headers: responseHeaders },
    )
  } catch {
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: responseHeaders },
    )
  }
}
