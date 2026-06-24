import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkflow,
  listWorkflowVersions,
  listWorkflows,
  publishWorkflow,
  updateWorkflow,
  validateWorkflow,
} from './workflows'

const workflow = {
  id: 'workflow-1',
  name: '新品研究流程',
  status: '草稿',
  version: '未发布',
  nodes: [],
  edges: [],
  createdAt: '2026-06-24T07:00:00Z',
  updatedAt: '2026-06-24T07:00:00Z',
}

describe('Workflow API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('supports draft save, validation and immutable publication', async () => {
    const version = {
      id: 'workflow-version-1',
      version: 'v1.0.0',
      snapshot: workflow,
      createdAt: '2026-06-24T07:10:00Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([workflow]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(workflow), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(workflow), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true, errors: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(version), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([version]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const draft = { name: workflow.name, nodes: [], edges: [] }

    await expect(listWorkflows()).resolves.toEqual([workflow])
    await expect(createWorkflow(draft)).resolves.toEqual(workflow)
    await expect(updateWorkflow(workflow.id, draft)).resolves.toEqual(workflow)
    await expect(validateWorkflow(workflow.id)).resolves.toEqual({ valid: true, errors: [] })
    await expect(publishWorkflow(workflow.id)).resolves.toEqual(version)
    await expect(listWorkflowVersions(workflow.id)).resolves.toEqual([version])
  })
})
