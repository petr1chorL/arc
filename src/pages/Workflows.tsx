import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Bot, Braces, Check, ChevronDown, Clock3, Database, GitBranch, Play, Plus, Save, Search, ShieldCheck, UserCheck, Wrench } from 'lucide-react'
import { useCallback, useState } from 'react'
import { WorkflowNode, type WorkflowNodeData } from '../components/WorkflowNode'

const nodeTypes = { workflow: WorkflowNode }

const initialNodes: Node[] = [
  { id: '1', type: 'workflow', position: { x: 40, y: 230 }, data: { label: '定时触发', subtitle: '每周一 09:00', kind: 'trigger', status: 'success' } satisfies WorkflowNodeData },
  { id: '2', type: 'workflow', position: { x: 285, y: 230 }, data: { label: '收集用户反馈', subtitle: '数据查询节点', kind: 'data', status: 'success' } satisfies WorkflowNodeData },
  { id: '3', type: 'workflow', position: { x: 540, y: 110 }, data: { label: '需求信号提取', subtitle: '需求洞察 Agent', kind: 'agent', status: 'success', score: 92 } satisfies WorkflowNodeData },
  { id: '4', type: 'workflow', position: { x: 540, y: 350 }, data: { label: '竞品并行研究', subtitle: '竞品研究 Agent', kind: 'agent', status: 'running' } satisfies WorkflowNodeData },
  { id: '5', type: 'workflow', position: { x: 810, y: 230 }, data: { label: '质量门禁', subtitle: '竞品分析标准 v2.1', kind: 'gate', status: 'idle' } satisfies WorkflowNodeData },
  { id: '6', type: 'workflow', position: { x: 1060, y: 230 }, data: { label: '判断分数', subtitle: '≥ 85 自动流转', kind: 'branch', status: 'idle' } satisfies WorkflowNodeData },
  { id: '7', type: 'workflow', position: { x: 1310, y: 110 }, data: { label: '产品定义', subtitle: '产品定义 Agent', kind: 'agent', status: 'idle' } satisfies WorkflowNodeData },
  { id: '8', type: 'workflow', position: { x: 1310, y: 350 }, data: { label: '人工快速审核', subtitle: '产品经理队列', kind: 'human', status: 'warning' } satisfies WorkflowNodeData },
  { id: '9', type: 'workflow', position: { x: 1570, y: 230 }, data: { label: '流程完成', subtitle: '发送飞书通知', kind: 'end', status: 'idle' } satisfies WorkflowNodeData },
]

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', animated: true },
  { id: 'e2-3', source: '2', target: '3' },
  { id: 'e2-4', source: '2', target: '4', animated: true },
  { id: 'e3-5', source: '3', target: '5' },
  { id: 'e4-5', source: '4', target: '5', animated: true },
  { id: 'e5-6', source: '5', target: '6' },
  { id: 'e6-7', source: '6', target: '7', label: '通过' },
  { id: 'e6-8', source: '6', target: '8', label: '70–84' },
  { id: 'e7-9', source: '7', target: '9' },
  { id: 'e8-7', source: '8', target: '7' },
]

const palette = [
  { label: 'Agent', icon: Bot, kind: 'agent' },
  { label: '工具调用', icon: Wrench, kind: 'tool' },
  { label: '数据查询', icon: Database, kind: 'data' },
  { label: '条件分支', icon: GitBranch, kind: 'branch' },
  { label: '质量门禁', icon: ShieldCheck, kind: 'gate' },
  { label: '人工审核', icon: UserCheck, kind: 'human' },
  { label: '代码执行', icon: Braces, kind: 'code' },
  { label: '等待节点', icon: Clock3, kind: 'wait' },
]

export function Workflows() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(nodes[3])
  const [saved, setSaved] = useState(false)
  const onConnect = useCallback((connection: Connection) => setEdges((items) => addEdge(connection, items)), [setEdges])

  const save = () => {
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="workflow-studio">
      {saved && <div className="toast"><Check size={16} />工作流草稿已保存</div>}
      <div className="studio-toolbar">
        <div className="workflow-title">
          <button className="workflow-icon"><GitBranch size={18} /></button>
          <div><strong>新品机会发现与产品定义</strong><span>草稿 · v1.7</span></div>
          <ChevronDown size={15} />
        </div>
        <div className="studio-actions">
          <button className="button ghost">版本记录</button>
          <button className="button secondary" onClick={save}><Save size={15} />保存</button>
          <button className="button primary"><Play size={15} />试运行</button>
        </div>
      </div>

      <div className="studio-body">
        <aside className="node-palette">
          <label className="palette-search"><Search size={15} /><input placeholder="搜索节点" /></label>
          <span className="nav-section-label">基础节点</span>
          {palette.map(({ label, icon: Icon, kind }) => (
            <button key={label} draggable className="palette-item" title={`添加${label}节点`}>
              <span className={`palette-icon ${kind}`}><Icon size={16} /></span>{label}<Plus size={14} />
            </button>
          ))}
        </aside>

        <div className="flow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNode(node)}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.35}
            maxZoom={1.5}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} color="#c7ccc9" />
            <Controls position="bottom-left" />
            <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => {
              const data = node.data as WorkflowNodeData
              return data.kind === 'human' ? '#ef9f50' : data.kind === 'gate' ? '#2e7d6c' : '#707975'
            }} />
          </ReactFlow>
          <div className="canvas-status"><span className="live-dot" />自动保存已开启 · 9 个节点</div>
        </div>

        {selectedNode && <NodeInspector node={selectedNode} onClose={() => setSelectedNode(null)} onRename={(label) => {
          setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, label } } : node))
          setSelectedNode((node) => node ? { ...node, data: { ...node.data, label } } : null)
        }} />}
      </div>
    </div>
  )
}

function NodeInspector({ node, onClose, onRename }: { node: Node; onClose: () => void; onRename: (label: string) => void }) {
  const data = node.data as WorkflowNodeData
  return (
    <aside className="node-inspector">
      <header><div><span className="section-kicker">节点配置</span><h3>{data.label}</h3></div><button onClick={onClose}>×</button></header>
      <label className="form-field"><span>节点名称</span><input value={data.label} onChange={(event) => onRename(event.target.value)} /></label>
      <label className="form-field"><span>执行 Agent</span><select defaultValue="competitive"><option value="competitive">竞品研究 Agent · v1.8</option><option>需求洞察 Agent · v2.4</option></select></label>
      <label className="form-field"><span>输入数据对象</span><select><option>需求机会对象 v1.2</option></select></label>
      <label className="form-field"><span>输出产出物</span><select><option>竞品分析矩阵 v2.0</option></select></label>
      <div className="inspector-section">
        <div><span>失败重试</span><label className="toggle"><input type="checkbox" defaultChecked /><i /></label></div>
        <div><span>最长运行时间</span><strong>15 分钟</strong></div>
        <div><span>质量门禁</span><strong>竞品分析 v2.1</strong></div>
      </div>
      <button className="button secondary full">打开高级配置</button>
    </aside>
  )
}
