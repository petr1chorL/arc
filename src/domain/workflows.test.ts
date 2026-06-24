import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { fromContractGraph, toContractGraph } from './workflows'

describe('workflow graph contract adapter', () => {
  it('preserves node kind, position and Agent version references', () => {
    const nodes: Node[] = [{
      id: 'agent-node',
      type: 'workflow',
      position: { x: 120, y: 80 },
      data: {
        label: '研究 Agent',
        subtitle: '研究 Agent · v1.0.0',
        kind: 'agent',
        status: 'idle',
        agentId: 'agent-1',
        agentVersion: 'v1.0.0',
      },
    }]
    const edges: Edge[] = [{ id: 'edge-1', source: 'start', target: 'agent-node', label: '通过' }]

    const contract = toContractGraph(nodes, edges)
    const restored = fromContractGraph(contract.nodes, contract.edges)

    expect(contract.nodes[0]).toMatchObject({
      id: 'agent-node',
      type: 'agent',
      position: { x: 120, y: 80 },
      data: { agentId: 'agent-1', agentVersion: 'v1.0.0' },
    })
    expect(restored.nodes[0]).toMatchObject({
      id: 'agent-node',
      type: 'workflow',
      data: { kind: 'agent', agentVersion: 'v1.0.0' },
    })
    expect(restored.edges[0]).toMatchObject({ label: '通过' })
  })
})
