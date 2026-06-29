import { afterEach, describe, expect, it, vi } from 'vitest'
import { listArtifacts } from './artifacts'

const artifact = {
  artifactId: 'artifact-1',
  artifactVersionId: 'artifact-version-1',
  version: 1,
  runId: 'run-1',
  sourceNodeRunId: 'node-run-1',
  content: '{"summary":"Catalog visible structured output."}',
  score: 98,
  dataObjectDefinitionId: 'data-object-1',
  dataObjectVersionId: 'data-object-version-1',
  dataObjectSnapshot: {
    name: 'Structured Insight',
    schema: { type: 'object', required: ['summary'] },
  },
  schemaValidation: {
    status: 'passed',
    label: 'Schema 校验通过',
    reasons: [],
  },
  createdAt: '2026-06-28T09:00:00Z',
}

describe('artifacts api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists artifacts with an optional data object filter', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      calls.push({ url, init })
      if (url === '/api/workspaces/workspace-1/artifacts?dataObjectDefinitionId=data-object-1&schemaValidationStatus=failed') {
        return Promise.resolve(new Response(JSON.stringify([artifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    }))

    await expect(listArtifacts('workspace-1', {
      dataObjectDefinitionId: 'data-object-1',
      schemaValidationStatus: 'failed',
    })).resolves.toEqual([artifact])

    expect(calls[0].url).toBe(
      '/api/workspaces/workspace-1/artifacts?dataObjectDefinitionId=data-object-1&schemaValidationStatus=failed',
    )
  })
})
