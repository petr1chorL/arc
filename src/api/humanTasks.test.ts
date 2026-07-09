import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimHumanTask,
  confirmFeedbackCandidate,
  decideHumanTask,
  transferHumanTask,
} from './humanTasks'

const workspaceId = 'workspace-1'
const taskId = 'task-1'

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status }))
}

describe('Human Task API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('claims with an empty body so the server resolves the reviewer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      await jsonResponse({ id: taskId, assigneeReviewerId: 'reviewer-1' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await claimHumanTask(workspaceId, taskId)

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/human-tasks/${taskId}/claim`,
      expect.objectContaining({ method: 'POST' }),
    )
    const [, init] = fetchMock.mock.calls[0]
    expect(init).not.toHaveProperty('body')
  })

  it('transfers without a client-controlled actor id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      await jsonResponse({ id: taskId, assigneeReviewerId: 'reviewer-2' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await transferHumanTask(workspaceId, taskId, {
      targetReviewerId: 'reviewer-2',
      reason: '需要专家处理',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init?.body as string)
    expect(body).toEqual({
      targetReviewerId: 'reviewer-2',
      reason: '需要专家处理',
    })
    expect(body).not.toHaveProperty('reviewerId')
    expect(body).not.toHaveProperty('actorId')
  })

  it('submits decisions without a reviewer id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      await jsonResponse({ id: taskId, artifact: { id: 'artifact-v1' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await decideHumanTask(workspaceId, taskId, {
      decision: 'approve',
      reason: '符合标准',
      artifactVersionId: 'artifact-v1',
      idempotencyKey: 'decision-1',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init?.body as string)
    expect(body).toEqual({
      decision: 'approve',
      reason: '符合标准',
      artifactVersionId: 'artifact-v1',
      idempotencyKey: 'decision-1',
    })
    expect(body).not.toHaveProperty('reviewerId')
  })

  it('confirms golden samples without a reviewer id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      await jsonResponse({ id: 'golden-1', candidateId: 'candidate-1' }, 201),
    )
    vi.stubGlobal('fetch', fetchMock)

    await confirmFeedbackCandidate(workspaceId, 'candidate-1', {
      reason: '专家确认',
      idempotencyKey: 'confirm-1',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init?.body as string)
    expect(body).toEqual({
      reason: '专家确认',
      idempotencyKey: 'confirm-1',
    })
    expect(body).not.toHaveProperty('reviewerId')
  })
})
