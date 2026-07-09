import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDataObjectDefinition,
  listDataObjectDefinitions,
  publishDataObjectDefinition,
  updateDataObjectDefinition,
} from './dataObjects'

const definition = {
  id: 'data-object-1',
  name: 'Product Brief',
  description: 'Structured product brief',
  schema: { type: 'object', required: ['asin'] },
  status: 'draft',
  version: 'unpublished',
  createdBy: 'admin',
  createdAt: '2026-06-28T00:00:00Z',
  updatedAt: '2026-06-28T00:00:00Z',
}

describe('dataObjects api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists creates updates and publishes data object definitions', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      calls.push({ url, init })
      if (url === '/api/workspaces/workspace-1/data-objects' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([definition]), { status: 200 }))
      }
      if (url === '/api/workspaces/workspace-1/data-objects' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(definition), { status: 201 }))
      }
      if (url === '/api/workspaces/workspace-1/data-objects/data-object-1' && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({ ...definition, name: 'Updated Brief' }), { status: 200 }))
      }
      if (url === '/api/workspaces/workspace-1/data-objects/data-object-1/publish' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'version-1',
          definitionId: definition.id,
          version: 'v1.0.0',
          snapshot: definition,
          createdAt: '2026-06-28T00:01:00Z',
        }), { status: 201 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    }))

    await expect(listDataObjectDefinitions('workspace-1')).resolves.toEqual([definition])
    await createDataObjectDefinition('workspace-1', {
      name: definition.name,
      description: definition.description,
      schema: definition.schema,
    })
    await updateDataObjectDefinition('workspace-1', definition.id, { name: 'Updated Brief' })
    await publishDataObjectDefinition('workspace-1', definition.id)

    expect(calls.map((call) => call.url)).toEqual([
      '/api/workspaces/workspace-1/data-objects',
      '/api/workspaces/workspace-1/data-objects',
      '/api/workspaces/workspace-1/data-objects/data-object-1',
      '/api/workspaces/workspace-1/data-objects/data-object-1/publish',
    ])
    expect(calls[1].init?.body).toBe(JSON.stringify({
      name: definition.name,
      description: definition.description,
      schema: definition.schema,
    }))
  })
})
