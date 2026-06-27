import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRubric,
  deactivateRubric,
  getEvaluationOverview,
  getRubrics,
  listRubricVersions,
  publishRubric,
  updateRubric,
} from './evaluations'

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

  it('manages the rubric lifecycle for a workspace', async () => {
    const rubric = {
      id: 'rubric-1',
      name: 'Lifecycle Rubric',
      artifact: 'Artifact',
      dimensions: [{ name: 'Accuracy', weight: 100 }],
      gate: 'Must pass',
      passScore: 85,
      version: 'v0.1.0',
      status: 'draft',
    }
    const input = {
      name: rubric.name,
      artifact: rubric.artifact,
      dimensions: rubric.dimensions,
      gate: rubric.gate,
      passScore: rubric.passScore,
    }
    const version = {
      id: 'version-1',
      version: 'v1.0.0',
      snapshot: { ...rubric, version: 'v1.0.0', status: 'active' },
      createdAt: '2026-06-27T00:00:00Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(await jsonResponse(rubric, 201))
      .mockResolvedValueOnce(await jsonResponse({ ...rubric, passScore: 90 }))
      .mockResolvedValueOnce(await jsonResponse(version, 201))
      .mockResolvedValueOnce(await jsonResponse([version]))
      .mockResolvedValueOnce(await jsonResponse({ ...rubric, status: 'disabled' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createRubric(workspaceId, input)).resolves.toEqual(rubric)
    await expect(updateRubric(workspaceId, rubric.id, { ...input, passScore: 90 })).resolves.toMatchObject({ passScore: 90 })
    await expect(publishRubric(workspaceId, rubric.id)).resolves.toEqual(version)
    await expect(listRubricVersions(workspaceId, rubric.id)).resolves.toEqual([version])
    await expect(deactivateRubric(workspaceId, rubric.id)).resolves.toMatchObject({ status: 'disabled' })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/workspaces/${workspaceId}/evaluations/rubrics`,
      `/api/workspaces/${workspaceId}/evaluations/rubrics/${rubric.id}`,
      `/api/workspaces/${workspaceId}/evaluations/rubrics/${rubric.id}/publish`,
      `/api/workspaces/${workspaceId}/evaluations/rubrics/${rubric.id}/versions`,
      `/api/workspaces/${workspaceId}/evaluations/rubrics/${rubric.id}/deactivate`,
    ])
    const createInit = fetchMock.mock.calls[0][1] as RequestInit
    const updateInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(new Headers(createInit.headers).get('Content-Type')).toBe('application/json')
    expect(new Headers(updateInit.headers).get('Content-Type')).toBe('application/json')
  })
})
