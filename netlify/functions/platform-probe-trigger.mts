import { AsyncWorkloadsClient } from '@netlify/async-workloads'
import { getDatabase } from '@netlify/database'

import { createPlatformProbeTriggerHandler } from './_shared/platform-probe-trigger.ts'

interface PlatformProbeWorkloadEvent {
  eventName: 'arc-one:platform-probe'
  eventData: {
    operationId: string
    simulateFailureOnce?: boolean
  }
}

export default async (request: Request): Promise<Response> => {
  const database = getDatabase()
  const handler = createPlatformProbeTriggerHandler({
    async claimSuite(suiteId) {
      const rows = await database.sql`
        INSERT INTO netlify_platform_probe_dispatches (suite_id, status)
        VALUES (${suiteId}, 'claimed')
        ON CONFLICT (suite_id) DO UPDATE
        SET status = 'claimed', updated_at = CURRENT_TIMESTAMP
        WHERE netlify_platform_probe_dispatches.status = 'failed'
        RETURNING suite_id
      `
      return rows.length === 1
    },
    async completeSuite(suiteId, eventIds) {
      await database.sql`
        UPDATE netlify_platform_probe_dispatches
        SET status = 'completed',
            event_ids = ${JSON.stringify(eventIds)}::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE suite_id = ${suiteId}
      `
    },
    async failSuite(suiteId) {
      await database.sql`
        UPDATE netlify_platform_probe_dispatches
        SET status = 'failed', updated_at = CURRENT_TIMESTAMP
        WHERE suite_id = ${suiteId}
      `
    },
  }, (baseUrl) => new AsyncWorkloadsClient<PlatformProbeWorkloadEvent>({ baseUrl }))
  return handler(request)
}
