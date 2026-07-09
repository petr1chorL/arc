import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRubric,
  deactivateRubric,
  evaluateRubric,
  getEvaluationOverview,
  getRubrics,
  listEvaluationRecords,
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
      expect.objectContaining({ credentials: 'include' }),
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
      expect.objectContaining({ credentials: 'include' }),
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

  it('runs and lists evaluation records for a rubric', async () => {
    const record = {
      id: 'evaluation-1',
      rubricId: 'rubric-1',
      rubricVersion: 'v1.0.0',
      rubricSnapshot: {
        id: 'rubric-1',
        name: 'Lifecycle Rubric',
        artifact: 'Artifact',
        dimensions: [{ name: 'Accuracy', weight: 100 }],
        gate: 'Must pass',
        passScore: 80,
        version: 'v1.0.0',
        status: 'active',
      },
      subjectType: 'manual_artifact',
      subjectId: 'artifact-1',
      artifactText: 'A sourced artifact with clear next actions.',
      dimensionScores: [{ name: 'Accuracy', weight: 100, score: 88 }],
      score: 88,
      status: 'passed',
      rationale: 'deterministic rubric evaluation',
      createdAt: '2026-06-27T00:00:00Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(await jsonResponse(record, 201))
      .mockResolvedValueOnce(await jsonResponse([record]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(evaluateRubric(workspaceId, 'rubric-1', {
      artifactText: record.artifactText,
      subjectType: 'manual_artifact',
      subjectId: 'artifact-1',
    })).resolves.toEqual(record)
    await expect(listEvaluationRecords(workspaceId)).resolves.toEqual([record])

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/workspaces/${workspaceId}/evaluations/rubrics/rubric-1/evaluate`,
      `/api/workspaces/${workspaceId}/evaluations/records`,
    ])
    const evaluateInit = fetchMock.mock.calls[0][1] as RequestInit
    expect(evaluateInit.method).toBe('POST')
    expect(new Headers(evaluateInit.headers).get('Content-Type')).toBe('application/json')
  })
})
