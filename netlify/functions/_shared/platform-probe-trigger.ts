export const PLATFORM_PROBE_SUITE_ID = 'platform-gate-20260904-v1'

export interface PlatformProbeTriggerRepository {
  claimSuite(suiteId: string): Promise<boolean>
  completeSuite(suiteId: string, eventIds: string[]): Promise<void>
  failSuite(suiteId: string): Promise<void>
}

export interface PlatformProbeSender {
  send(
    eventName: 'arc-one:platform-probe',
    options: {
      data: {
        operationId: string
        simulateFailureOnce?: boolean
      }
    },
  ): Promise<{ sendStatus: 'succeeded' | 'failed'; eventId: string }>
}

export type PlatformProbeSenderFactory = (baseUrl: string) => PlatformProbeSender

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

export function createPlatformProbeTriggerHandler(
  repository: PlatformProbeTriggerRepository,
  createSender: PlatformProbeSenderFactory,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return Response.json(
        { status: 'method-not-allowed' },
        { status: 405, headers: { ...responseHeaders, Allow: 'POST' } },
      )
    }

    const claimed = await repository.claimSuite(PLATFORM_PROBE_SUITE_ID)
    if (!claimed) {
      return Response.json(
        { status: 'already-triggered' },
        { status: 200, headers: responseHeaders },
      )
    }

    try {
      const sender = createSender(request.url)
      const results = await Promise.all([
        sender.send('arc-one:platform-probe', {
          data: { operationId: 'platform-gate-idempotency-v1' },
        }),
        sender.send('arc-one:platform-probe', {
          data: { operationId: 'platform-gate-idempotency-v1' },
        }),
        sender.send('arc-one:platform-probe', {
          data: {
            operationId: 'platform-gate-retry-v1',
            simulateFailureOnce: true,
          },
        }),
      ])
      if (results.some((result) => result.sendStatus !== 'succeeded')) {
        throw new Error('Async Workloads rejected a platform probe event')
      }
      await repository.completeSuite(
        PLATFORM_PROBE_SUITE_ID,
        results.map((result) => result.eventId),
      )
      return Response.json(
        { status: 'accepted' },
        { status: 202, headers: responseHeaders },
      )
    } catch {
      await repository.failSuite(PLATFORM_PROBE_SUITE_ID)
      return Response.json(
        { status: 'dispatch-failed' },
        { status: 503, headers: responseHeaders },
      )
    }
  }
}
