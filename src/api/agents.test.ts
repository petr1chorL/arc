import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAgent,
  deactivateAgent,
  getAgent,
  listAgentVersions,
  listAgents,
  publishAgent,
  updateAgent,
} from './agents'

const apiAgent = {
  id: '6c8c51ec-178c-4517-838c-93b41c0bf1a0',
  name: '用户洞察 Agent',
  role: '汇总访谈并提炼用户需求',
  owner: '产品创新组',
  model: 'GPT-5',
  status: '调试中',
  version: 'v0.1.0',
  passRate: 0,
  runs: 0,
  tools: [],
  skills: [],
  systemPrompt: '',
  runtimeManifest: {},
  createdAt: '2026-06-24T06:00:00Z',
  updatedAt: '2026-06-24T06:00:00Z',
}

describe('Agent API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the complete Agent list contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify([apiAgent]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    await expect(listAgents()).resolves.toEqual([apiAgent])
  })

  it('creates an Agent using the minimum required fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(apiAgent), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(createAgent({
      name: apiAgent.name,
      role: apiAgent.role,
      owner: apiAgent.owner,
      model: apiAgent.model,
    })).resolves.toEqual(apiAgent)

    expect(fetchMock).toHaveBeenCalledWith('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: apiAgent.name,
        role: apiAgent.role,
        owner: apiAgent.owner,
        model: apiAgent.model,
      }),
    })
  })

  it('throws an explicit error when the API rejects a request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: '名称不能为空' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    await expect(createAgent({
      name: '',
      role: apiAgent.role,
      owner: apiAgent.owner,
      model: apiAgent.model,
    })).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      message: '名称不能为空',
    })
  })

  it('loads, updates, publishes and deactivates an Agent lifecycle', async () => {
    const version = {
      id: 'ver-1',
      version: 'v1.0.0',
      snapshot: apiAgent,
      createdAt: '2026-06-24T06:10:00Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(apiAgent), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(apiAgent), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([version]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(version), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...apiAgent, status: '已停用' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAgent(apiAgent.id)).resolves.toEqual(apiAgent)
    await expect(updateAgent(apiAgent.id, {
      name: apiAgent.name,
      role: apiAgent.role,
      owner: apiAgent.owner,
      model: apiAgent.model,
      systemPrompt: '严谨输出',
      tools: ['Web Search'],
      skills: ['竞品分析'],
      runtimeManifest: {},
    })).resolves.toEqual(apiAgent)
    await expect(listAgentVersions(apiAgent.id)).resolves.toEqual([version])
    await expect(publishAgent(apiAgent.id)).resolves.toEqual(version)
    await expect(deactivateAgent(apiAgent.id)).resolves.toMatchObject({ status: '已停用' })
  })
})
