import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import {
  Bot,
  CircleCheck,
  Database,
  GitBranch,
  Play,
  ShieldCheck,
  UserCheck,
} from 'lucide-react'

export type WorkflowNodeData = {
  label: string
  subtitle: string
  kind: 'trigger' | 'agent' | 'data' | 'gate' | 'human' | 'branch' | 'end'
  status?: 'idle' | 'running' | 'success' | 'warning'
  score?: number
}

const icons = {
  trigger: Play,
  agent: Bot,
  data: Database,
  gate: ShieldCheck,
  human: UserCheck,
  branch: GitBranch,
  end: CircleCheck,
}

export function WorkflowNode({ data, selected }: NodeProps) {
  const nodeData = data as WorkflowNodeData
  const Icon = icons[nodeData.kind]

  return (
    <div
      className={`workflow-node ${nodeData.kind} ${nodeData.status ?? 'idle'} ${selected ? 'selected' : ''}`}
      data-node-kind={nodeData.kind}
      data-node-status={nodeData.status ?? 'idle'}
    >
      {nodeData.kind !== 'trigger' && <Handle type="target" position={Position.Left} />}
      <div className="node-icon"><Icon size={17} /></div>
      <div className="node-copy">
        <strong>{nodeData.label}</strong>
        <span>{nodeData.subtitle}</span>
      </div>
      {nodeData.score !== undefined && <b className="node-score">{nodeData.score}</b>}
      {nodeData.kind !== 'end' && <Handle type="source" position={Position.Right} />}
    </div>
  )
}
