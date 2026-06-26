import { afterEach, describe, expect, it, vi } from 'vitest'
import { listWorkspaces } from './workspaces'

describe('Workspace API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads accessible workspaces from the workspace endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify([
        {
          id: 'workspace-1',
          name: 'AI 能力中心',
          slug: 'ai-capability-center',
        },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    await expect(listWorkspaces()).resolves.toEqual([
      {
        id: 'workspace-1',
        name: 'AI 能力中心',
        slug: 'ai-capability-center',
      },
    ])
  })
})
