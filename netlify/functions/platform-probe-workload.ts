import { asyncWorkloadFn } from '@netlify/async-workloads'
import type { AsyncWorkloadConfig, CustomAsyncWorkloadEvent } from '@netlify/async-workloads'
import { getDatabase } from '@netlify/database'

import { createPlatformProbeHandler } from './_shared/platform-probe.ts'

interface PlatformProbeWorkloadEvent extends CustomAsyncWorkloadEvent {
  eventName: 'arc-one:platform-probe'
  eventData: {
    operationId: string
    simulateFailureOnce?: boolean
  }
}

export default asyncWorkloadFn<PlatformProbeWorkloadEvent>(async (event) => {
  const database = getDatabase()
  const handler = createPlatformProbeHandler({
    async claim(operationId, eventId) {
      const rows = await database.sql`
        INSERT INTO netlify_platform_probe_events (operation_id, last_event_id, status)
        VALUES (${operationId}, ${eventId}, 'started')
        ON CONFLICT (operation_id) DO UPDATE
        SET attempt_count = netlify_platform_probe_events.attempt_count + 1
        WHERE netlify_platform_probe_events.status = 'started'
          AND netlify_platform_probe_events.last_event_id = EXCLUDED.last_event_id
        RETURNING attempt_count
      `
      return {
        shouldRun: rows.length === 1,
        attemptCount: Number(rows[0]?.attempt_count ?? 0),
      }
    },
    async complete(operationId) {
      await database.sql`
        UPDATE netlify_platform_probe_events
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE operation_id = ${operationId}
      `
    },
  })
  await handler({
    eventId: event.eventId,
    operationId: event.eventData.operationId,
    simulateFailureOnce: event.eventData.simulateFailureOnce,
  })
})

export const asyncWorkloadConfig: AsyncWorkloadConfig<PlatformProbeWorkloadEvent> = {
  events: ['arc-one:platform-probe'],
  maxRetries: 4,
}
