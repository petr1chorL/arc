import { describe, expect, it } from 'vitest'

import {
  findLatestRecoverableRun,
  formatRunFailure,
  readAcceptanceResponse,
  waitForRunCompletion,
} from './v1-lite-acceptance-utils.mjs'

describe('readAcceptanceResponse', () => {
  it('reports a non-JSON gateway response without echoing HTML', async () => {
    const response = new Response('<html>gateway timeout</html>', {
      status: 504,
      headers: { 'Content-Type': 'text/html' },
    })

    await expect(readAcceptanceResponse(response, {
      method: 'POST',
      path: '/api/workspaces/workspace-1/workflows/workflow-1/runs',
    })).rejects.toThrow(
      'POST /api/workspaces/workspace-1/workflows/workflow-1/runs failed with HTTP 504: expected JSON but received text/html',
    )
  })
})

describe('findLatestRecoverableRun', () => {
  it('returns the latest matching pending run inside the recovery window', () => {
    const input = JSON.stringify({ sourceNotes: 'acceptance' })
    const run = findLatestRecoverableRun([
      {
        id: 'unrelated-newer',
        workflowId: 'workflow-2',
        input,
        status: '等待审核',
        startedAt: '2026-07-16T00:09:00.000Z',
      },
      {
        id: 'matching-latest',
        workflowId: 'workflow-1',
        input,
        status: '等待审核',
        startedAt: '2026-07-16T00:08:00.000Z',
      },
      {
        id: 'matching-completed',
        workflowId: 'workflow-1',
        input,
        status: '已完成',
        startedAt: '2026-07-16T00:07:00.000Z',
      },
    ], {
      workflowId: 'workflow-1',
      input,
      now: Date.parse('2026-07-16T00:10:00.000Z'),
      maxAgeMs: 10 * 60 * 1000,
    })

    expect(run?.id).toBe('matching-latest')
  })

  it('does not resume a stale pending run', () => {
    const input = JSON.stringify({ sourceNotes: 'acceptance' })
    const run = findLatestRecoverableRun([{
      id: 'stale-run',
      workflowId: 'workflow-1',
      input,
      status: '等待审核',
      startedAt: '2026-07-15T20:00:00.000Z',
    }], {
      workflowId: 'workflow-1',
      input,
      now: Date.parse('2026-07-16T00:10:00.000Z'),
      maxAgeMs: 60 * 60 * 1000,
    })

    expect(run).toBeNull()
  })
})
describe('waitForRunCompletion', () => {
  it('polls an existing run through a gateway timeout until it completes', async () => {
    const states = [
      { id: 'run-1', status: '审核中' },
      { id: 'run-1', status: '已完成' },
    ]
    const loadRun = async () => states.shift()
    const sleep = async () => {}

    const run = await waitForRunCompletion(loadRun, {
      maxAttempts: 3,
      retryDelayMs: 0,
      sleep,
    })

    expect(run.status).toBe('已完成')
  })

  it('returns immediately when workflow recovery fails', async () => {
    let calls = 0
    const loadRun = async () => {
      calls += 1
      return { id: 'run-1', status: '恢复失败' }
    }

    const run = await waitForRunCompletion(loadRun, {
      maxAttempts: 3,
      retryDelayMs: 0,
      sleep: async () => {},
    })

    expect(run.status).toBe('恢复失败')
    expect(calls).toBe(1)
  })
})

describe('formatRunFailure', () => {
  it('reports failed node errors without including node input or output', () => {
    const message = formatRunFailure({
      status: '恢复失败',
      error: '工作流恢复失败，请稍后重试',
      nodes: [{
        nodeName: '质量评分',
        status: '失败',
        error: '模型返回格式无效',
        input: 'sensitive input',
        output: 'sensitive output',
      }],
    })

    expect(message).toContain('质量评分: 模型返回格式无效')
    expect(message).not.toContain('sensitive input')
    expect(message).not.toContain('sensitive output')
  })
})
