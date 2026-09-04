import { describe, expect, it, vi } from 'vitest'

import { createPlatformProbeTriggerHandler } from '../netlify/functions/_shared/platform-probe-trigger.ts'

describe('Netlify Async Workload platform probe trigger', () => {
  it('dispatches one fixed probe suite and records the result', async () => {
    const repository = {
      claimSuite: vi.fn().mockResolvedValue(true),
      completeSuite: vi.fn().mockResolvedValue(undefined),
      failSuite: vi.fn().mockResolvedValue(undefined),
    }
    const send = vi.fn()
      .mockResolvedValueOnce({ sendStatus: 'succeeded', eventId: 'event-1' })
      .mockResolvedValueOnce({ sendStatus: 'succeeded', eventId: 'event-2' })
      .mockResolvedValueOnce({ sendStatus: 'succeeded', eventId: 'event-3' })
    const createSender = vi.fn(() => ({ send }))
    const handler = createPlatformProbeTriggerHandler(repository, createSender)

    const response = await handler(new Request('https://example.test/probe', { method: 'POST' }))

    expect(response.status).toBe(202)
    expect(createSender).toHaveBeenCalledWith('https://example.test/probe')
    expect(send).toHaveBeenNthCalledWith(1, 'arc-one:platform-probe', {
      data: { operationId: 'platform-gate-idempotency-v1' },
    })
    expect(send).toHaveBeenNthCalledWith(2, 'arc-one:platform-probe', {
      data: { operationId: 'platform-gate-idempotency-v1' },
    })
    expect(send).toHaveBeenNthCalledWith(3, 'arc-one:platform-probe', {
      data: { operationId: 'platform-gate-retry-v1', simulateFailureOnce: true },
    })
    expect(repository.completeSuite).toHaveBeenCalledWith(
      'platform-gate-20260904-v1',
      ['event-1', 'event-2', 'event-3'],
    )
    await expect(response.json()).resolves.toEqual({ status: 'accepted' })
  })

  it('does not dispatch the suite more than once', async () => {
    const repository = {
      claimSuite: vi.fn().mockResolvedValue(false),
      completeSuite: vi.fn(),
      failSuite: vi.fn(),
    }
    const send = vi.fn()
    const handler = createPlatformProbeTriggerHandler(repository, () => ({ send }))

    const response = await handler(new Request('https://example.test/probe', { method: 'POST' }))

    expect(response.status).toBe(200)
    expect(send).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({ status: 'already-triggered' })
  })

  it('records a generic failure without exposing the API key error', async () => {
    const repository = {
      claimSuite: vi.fn().mockResolvedValue(true),
      completeSuite: vi.fn(),
      failSuite: vi.fn().mockResolvedValue(undefined),
    }
    const send = vi.fn().mockRejectedValue(new Error('secret API key detail'))
    const handler = createPlatformProbeTriggerHandler(repository, () => ({ send }))

    const response = await handler(new Request('https://example.test/probe', { method: 'POST' }))

    expect(response.status).toBe(503)
    expect(repository.failSuite).toHaveBeenCalledWith('platform-gate-20260904-v1')
    await expect(response.json()).resolves.toEqual({ status: 'dispatch-failed' })
  })

  it('rejects methods other than POST', async () => {
    const repository = {
      claimSuite: vi.fn(),
      completeSuite: vi.fn(),
      failSuite: vi.fn(),
    }
    const handler = createPlatformProbeTriggerHandler(repository, () => ({ send: vi.fn() }))

    const response = await handler(new Request('https://example.test/probe'))

    expect(response.status).toBe(405)
    expect(repository.claimSuite).not.toHaveBeenCalled()
  })
})
