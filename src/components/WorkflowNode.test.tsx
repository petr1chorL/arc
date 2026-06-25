import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowNode } from './WorkflowNode'

vi.mock('@xyflow/react', () => ({
  Handle: ({
    'aria-label': ariaLabel,
    className,
  }: {
    'aria-label'?: string
    className?: string
  }) => <button aria-label={ariaLabel} className={className} />,
  Position: { Left: 'left', Right: 'right' },
}))

describe('WorkflowNode', () => {
  it('names input and output connection handles', () => {
    render(<WorkflowNode
      data={{
        label: '执行 Agent',
        subtitle: '等待连接',
        kind: 'agent',
      }}
      id="agent-1"
      selected={false}
      type="workflow"
      dragging={false}
      draggable
      selectable
      deletable
      isConnectable
      positionAbsoluteX={0}
      positionAbsoluteY={0}
      zIndex={0}
    />)

    expect(screen.getByRole('button', { name: '输入连接点' })).toHaveClass(
      'node-handle',
      'target',
    )
    expect(screen.getByRole('button', { name: '输出连接点' })).toHaveClass(
      'node-handle',
      'source',
    )
  })
})
