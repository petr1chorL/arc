import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AgentCreateDialog } from './AgentCreateDialog'

describe('AgentCreateDialog', () => {
  it('shows field-level errors and does not submit blank values', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <AgentCreateDialog
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: '创建 Agent' }))

    expect(await screen.findAllByRole('alert')).toHaveLength(4)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the minimum required Agent fields', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <AgentCreateDialog
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('名称'), '用户洞察 Agent')
    await user.type(screen.getByLabelText('职责'), '汇总访谈并提炼用户需求')
    await user.type(screen.getByLabelText('负责人'), '产品创新组')
    await user.type(screen.getByLabelText('模型'), 'GPT-5')
    await user.click(screen.getByRole('button', { name: '创建 Agent' }))

    expect(onSubmit).toHaveBeenCalledWith({
      name: '用户洞察 Agent',
      role: '汇总访谈并提炼用户需求',
      owner: '产品创新组',
      model: 'GPT-5',
    })
  })

  it('keeps the dialog open and shows a server error', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Agent 创建失败'))
    render(
      <AgentCreateDialog
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('名称'), '用户洞察 Agent')
    await user.type(screen.getByLabelText('职责'), '汇总访谈并提炼用户需求')
    await user.type(screen.getByLabelText('负责人'), '产品创新组')
    await user.type(screen.getByLabelText('模型'), 'GPT-5')
    await user.click(screen.getByRole('button', { name: '创建 Agent' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Agent 创建失败')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建 Agent' })).toBeEnabled()
  })
})
