import { describe, expect, it, vi } from 'vitest'

import { createPlatformProbeHandler } from '../netlify/functions/_shared/platform-probe.ts'

describe('Netlify Async Workload platform probe', () => {
  it('does not repeat the completion side effect for a duplicate event', async () => {
    const eventStates = new Map()
    const repository = {
      claim: vi.fn(async (operationId, eventId) => {
        const current = eventStates.get(operationId)
        if (current?.status === 'completed' || (current && current.eventId !== eventId)) {
          return { shouldRun: false, attemptCount: current.attemptCount }
        }
        const attemptCount = (current?.attemptCount ?? 0) + 1
        eventStates.set(operationId, { status: 'started', eventId, attemptCount })
        return { shouldRun: true, attemptCount }
      }),
      complete: vi.fn(async (operationId) => {
        const current = eventStates.get(operationId)
        eventStates.set(operationId, { ...current, status: 'completed' })
      }),
    }
    const handler = createPlatformProbeHandler(repository)

    await handler({ eventId: 'event-1', operationId: 'probe-operation-1' })
    await handler({ eventId: 'event-2', operationId: 'probe-operation-1' })

    expect(repository.claim).toHaveBeenCalledTimes(2)
    expect(repository.complete).toHaveBeenCalledOnce()
    expect(repository.complete).toHaveBeenCalledWith('probe-operation-1')
  })

  it('allows a failed event to resume on retry', async () => {
    const eventStates = new Map()
    const repository = {
      claim: vi.fn(async (operationId, eventId) => {
        const current = eventStates.get(operationId)
        if (current?.status === 'completed' || (current && current.eventId !== eventId)) {
          return { shouldRun: false, attemptCount: current.attemptCount }
        }
        const attemptCount = (current?.attemptCount ?? 0) + 1
        eventStates.set(operationId, { status: 'started', eventId, attemptCount })
        return { shouldRun: true, attemptCount }
      }),
      complete: vi.fn(async (operationId) => {
        const current = eventStates.get(operationId)
        eventStates.set(operationId, { ...current, status: 'completed' })
      }),
    }
    const handler = createPlatformProbeHandler(repository)

    const event = {
      eventId: 'event-retry-1',
      operationId: 'probe-operation-retry',
      simulateFailureOnce: true,
    }

    await expect(handler(event)).rejects.toThrow('simulated transient probe failure')
    await expect(handler(event)).resolves.toBeUndefined()
    expect(repository.claim).toHaveBeenCalledTimes(2)
    expect(repository.complete).toHaveBeenCalledOnce()
  })

  it('does not let a concurrent delivery claim an operation owned by another event', async () => {
    const repository = {
      claim: vi.fn()
        .mockResolvedValueOnce({ shouldRun: true, attemptCount: 1 })
        .mockResolvedValueOnce({ shouldRun: false, attemptCount: 1 }),
      complete: vi.fn().mockResolvedValue(undefined),
    }
    const handler = createPlatformProbeHandler(repository)

    await Promise.all([
      handler({ eventId: 'event-a', operationId: 'shared-operation' }),
      handler({ eventId: 'event-b', operationId: 'shared-operation' }),
    ])

    expect(repository.complete).toHaveBeenCalledOnce()
  })
})
