import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useOperationNotice } from './useOperationNotice'
import { operationUpdatedEvent } from '../api/operations'

afterEach(cleanup)
it('replaces pending submission copy with the persisted outcome, ignoring other workspaces', () => {
  const { result } = renderHook(() => useOperationNotice('ws'))
  act(() => result.current.accepted({operationId:'op',status:'queued',statusUrl:'/status'},'评估','尚未完成'))
  act(() => { window.dispatchEvent(new CustomEvent(operationUpdatedEvent,{detail:{workspaceId:'other',operation:{operationId:'op',status:'succeeded'}}})) })
  expect(result.current.notice).toBe('尚未完成')
  act(() => { window.dispatchEvent(new CustomEvent(operationUpdatedEvent,{detail:{workspaceId:'ws',operation:{operationId:'op',status:'succeeded'}}})) })
  expect(result.current.notice).toBe('评估：已完成。')
})
