export interface PlatformProbeRepository {
  claim(operationId: string, eventId: string): Promise<PlatformProbeClaim>
  complete(operationId: string): Promise<void>
}

export interface PlatformProbeEvent {
  eventId: string
  operationId: string
  simulateFailureOnce?: boolean
}

export interface PlatformProbeClaim {
  shouldRun: boolean
  attemptCount: number
}

export function createPlatformProbeHandler(repository: PlatformProbeRepository) {
  return async (event: PlatformProbeEvent): Promise<void> => {
    const claim = await repository.claim(event.operationId, event.eventId)
    if (!claim.shouldRun) return
    if (event.simulateFailureOnce && claim.attemptCount === 1) {
      throw new Error('simulated transient probe failure')
    }
    await repository.complete(event.operationId)
  }
}
