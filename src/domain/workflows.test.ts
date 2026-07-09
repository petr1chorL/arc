import { describe, expect, it } from 'vitest'
import { fromContractGraph, toContractGraph } from './workflows'

describe('workflow graph contract conversion', () => {
  it('preserves edge field mappings in both directions', () => {
    const contract = toContractGraph(
      [
        {
          id: 'source',
          type: 'workflow',
          position: { x: 0, y: 0 },
          data: { kind: 'trigger', label: 'Source' },
        },
        {
          id: 'target',
          type: 'workflow',
          position: { x: 300, y: 0 },
          data: { kind: 'agent', label: 'Target' },
        },
      ],
      [
        {
          id: 'source-target',
          source: 'source',
          target: 'target',
          data: {
            mappings: [
              { sourcePath: '$.asin', targetPath: '$.input.asin' },
            ],
          },
        },
      ],
    )

    expect(contract.edges[0].data).toEqual({
      mappings: [
        { sourcePath: '$.asin', targetPath: '$.input.asin' },
      ],
    })

    const graph = fromContractGraph(contract.nodes, contract.edges)

    expect(graph.edges[0].data).toEqual({
      mappings: [
        { sourcePath: '$.asin', targetPath: '$.input.asin' },
      ],
    })
  })
})
