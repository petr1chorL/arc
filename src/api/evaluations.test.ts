import { afterEach, describe, expect, it, vi } from 'vitest'
import { getEvaluationOverview, getRubrics } from './evaluations'

const workspaceId = 'workspace-1'

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status }))
}

describe('Evaluations API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the evaluation asset overview for a workspace', async () => {
    const payload = {
      totals: {
        feedbackCandidates: 2,
        pendingCandidates: 1,
        confirmedCandidates: 1,
        goldenSamples: 1,
        coveredWorkflows: 2,
        coveredAgents: 1,
      },
      recentCandidates: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(await jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const overview = await getEvaluationOverview(workspaceId)

    expect(overview).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/evaluations/overview`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('loads rubric assets for a workspace', async () => {
    const payload = [{
      id: 'rubric-api-1',
      name: 'API Rubric',
      artifact: 'Artifact',
      dimensions: [{ name: 'Accuracy', weight: 60 }],
      gate: 'Must pass',
      passScore: 85,
      version: 'v1.0',
      status: 'active',
    }]
    const fetchMock = vi.fn().mockResolvedValue(await jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const rubrics = await getRubrics(workspaceId)

    expect(rubrics).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/evaluations/rubrics`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })
})
