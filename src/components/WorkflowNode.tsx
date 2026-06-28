import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import {
  Bot,
  Braces,
  CircleCheck,
  Clock3,
  Database,
  GitBranch,
  Play,
  ShieldCheck,
  UserCheck,
  Wrench,
} from 'lucide-react'

export type WorkflowNodeData = {
  label: string
  subtitle: string
  kind: 'trigger' | 'agent' | 'tool' | 'data' | 'gate' | 'human' | 'branch' | 'code' | 'wait' | 'end'
  status?: 'idle' | 'running' | 'success' | 'warning'
  score?: number
}

const icons = {
  trigger: Play,
  agent: Bot,
  tool: Wrench,
  data: Database,
  gate: ShieldCheck,
  human: UserCheck,
  branch: GitBranch,
  code: Braces,
  wait: Clock3,
  end: CircleCheck,
}

export function WorkflowNode({ data, selected }: NodeProps) {
  const nodeData = data as WorkflowNodeData
  const nodeKind = nodeData.kind ?? 'agent'
  const Icon = icons[nodeKind] ?? Bot

  return (
    <div
      className={`workflow-node ${nodeKind} ${nodeData.status ?? 'idle'} ${selected ? 'selected' : ''}`}
      data-node-kind={nodeKind}
      data-node-status={nodeData.status ?? 'idle'}
    >
      {nodeKind !== 'trigger' && (
        <Handle
          aria-label="输入连接点"
          className="node-handle target"
          title="输入连接点"
          type="target"
          position={Position.Left}
        />
      )}
      <div className="node-icon"><Icon size={17} /></div>
      <div className="node-copy">
        <strong>{nodeData.label}</strong>
        <span>{nodeData.subtitle}</span>
      </div>
      {nodeData.score !== undefined && <b className="node-score">{nodeData.score}</b>}
      {nodeKind !== 'end' && (
        <Handle
          aria-label="输出连接点"
          className="node-handle source"
          title="输出连接点"
          type="source"
          position={Position.Right}
        />
      )}
    </div>
  )
}
