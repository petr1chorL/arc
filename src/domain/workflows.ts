import type { Edge, Node } from '@xyflow/react'
import type { WorkflowEdgeContract, WorkflowNodeContract } from '../types'

interface ContractGraph {
  nodes: WorkflowNodeContract[]
  edges: WorkflowEdgeContract[]
}

export function toContractGraph(nodes: Node[], edges: Edge[]): ContractGraph {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: String(node.data.kind ?? 'agent'),
      position: node.position,
      data: { ...node.data },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(typeof edge.label === 'string' ? { label: edge.label } : {}),
      ...(edge.data && Object.keys(edge.data).length > 0 ? { data: { ...edge.data } } : {}),
    })),
  }
}

export function fromContractGraph(
  nodes: WorkflowNodeContract[],
  edges: WorkflowEdgeContract[],
): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: 'workflow',
      position: node.position,
      data: {
        ...node.data,
        kind: node.type,
        status: node.data.status ?? 'idle',
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.data ? { data: { ...edge.data } } : {}),
    })),
  }
}
