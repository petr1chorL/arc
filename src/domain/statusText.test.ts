import { describe, expect, it } from 'vitest'
import { displayStatus, isWaitingForHumanReview } from './statusText'

describe('statusText', () => {
  it('distinguishes uncertain delivery, dispatch progress and durable runtime termination', () => {
    expect(displayStatus('needs_reconciliation')).toBe('结果待核对')
    expect(displayStatus('dispatching')).toBe('派发中')
    expect(displayStatus('succeeded')).toBe('已完成')
    expect(displayStatus('canceled')).toBe('已取消')
    expect(displayStatus('dead_letter')).toBe('死信')
  })
  it('normalizes legacy mojibake statuses for display', () => {
    expect(displayStatus('宸插畬鎴?')).toBe('已完成')
    expect(displayStatus('宸插彂甯?')).toBe('已发布')
    expect(displayStatus('澶辫触')).toBe('失败')
    expect(displayStatus('寰呰棰?')).toBe('待认领')
  })

  it('keeps already-normal statuses unchanged', () => {
    expect(displayStatus('需介入')).toBe('需介入')
  })

  it('normalizes English and placeholder statuses for display', () => {
    expect(displayStatus('published')).toBe('已发布')
    expect(displayStatus(' draft ')).toBe('草稿')
    expect(displayStatus('unpublished')).toBe('未发布')
    expect(displayStatus('???')).toBe('状态未知')
  })

  it('detects human-review waiting status after normalization', () => {
    expect(isWaitingForHumanReview('需介入')).toBe(true)
    expect(isWaitingForHumanReview('宸插畬鎴?')).toBe(false)
  })
})
