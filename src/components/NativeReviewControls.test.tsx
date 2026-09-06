import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeReviewControls } from './NativeReviewControls'
import type { HumanTaskDetail, Reviewer } from '../types'

const reviewer: Reviewer = { id: 'reviewer-1', name: '审核员', role: 'reviewer', isExpert: false, isActive: true }
const detail = { id: 'task-1', status: '待认领', participantSnapshot: ['reviewer-1'], assigneeReviewerId: null,
  artifact: { id: 'artifact-1', version: 1, content: '原稿' }, approvalProgress: { required: 2, received: 1 }, reviewPolicy: 'all',
} as HumanTaskDetail
describe('NativeReviewControls', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  it('claims an eligible task and reloads the complete persisted detail', async () => {
    const updated = { ...detail, status: '审核中', assigneeReviewerId: reviewer.id }
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(updated))))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    render(<NativeReviewControls workspaceId="ws" detail={detail} reviewers={[reviewer]} groups={[]} reviewer={reviewer} canDecide={false} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: '认领审核任务' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated))
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws/human-tasks/task-1/claim', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws/human-tasks/task-1', expect.anything())
  })
  it('requires changed content and reason before modifying and approving, with exact artifact version', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(detail))))
    vi.stubGlobal('fetch', fetchMock)
    render(<NativeReviewControls workspaceId="ws" detail={{ ...detail, status: '审核中', assigneeReviewerId: reviewer.id }} reviewers={[reviewer]} groups={[]} reviewer={reviewer} canDecide onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: '修改后批准' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('修改后的产出物'), { target: { value: '修订稿' } })
    fireEvent.change(screen.getByLabelText('修改 / 转交依据'), { target: { value: '补充来源' } })
    fireEvent.click(screen.getByRole('button', { name: '修改后批准' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws/human-tasks/task-1/decisions', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"artifactVersionId":"artifact-1"') })))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ decision: 'modify_and_approve', modifiedContent: '修订稿', reason: '补充来源' })
  })
})
