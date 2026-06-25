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
import {
  Bot,
  Braces,
  Check,
  Clock3,
  Database,
  FilePlus2,
  GitBranch,
  History,
  Plus,
  Play,
  Save,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listAgentVersions, listAgents } from '../api/agents'
import {
  createWorkflow,
  listWorkflowVersions,
  listWorkflows,
  publishWorkflow,
  updateWorkflow,
  validateWorkflow,
} from '../api/workflows'
import { runWorkflow } from '../api/execution'
import { WorkflowNode, type WorkflowNodeData } from '../components/WorkflowNode'
import { fromContractGraph, toContractGraph } from '../domain/workflows'
import type { AgentVersion, ExecutionRun, WorkflowDraft, WorkflowVersion } from '../types'

const nodeTypes = { workflow: WorkflowNode }

const defaultNodes: Node[] = [
  {
    id: 'start',
    type: 'workflow',
    position: { x: 80, y: 220 },
    data: { label: '手动触发', subtitle: '启动工作流', kind: 'trigger', status: 'idle' } satisfies WorkflowNodeData,
  },
  {
    id: 'agent',
    type: 'workflow',
    position: { x: 390, y: 220 },
    data: { label: '选择执行 Agent', subtitle: '尚未绑定发布版本', kind: 'agent', status: 'warning' } satisfies WorkflowNodeData,
  },
  {
    id: 'end',
    type: 'workflow',
    position: { x: 720, y: 220 },
    data: { label: '流程完成', subtitle: '结束节点', kind: 'end', status: 'idle' } satisfies WorkflowNodeData,
  },
]

const defaultEdges: Edge[] = [
  { id: 'start-agent', source: 'start', target: 'agent' },
  { id: 'agent-end', source: 'agent', target: 'end' },
]

const palette: Array<{ label: string; icon: typeof Bot; kind: WorkflowNodeData['kind'] }> = [
  { label: 'Agent', icon: Bot, kind: 'agent' },
  { label: '工具调用', icon: Wrench, kind: 'tool' },
  { label: '数据查询', icon: Database, kind: 'data' },
  { label: '条件分支', icon: GitBranch, kind: 'branch' },
  { label: '质量门禁', icon: ShieldCheck, kind: 'gate' },
  { label: '人工审核', icon: UserCheck, kind: 'human' },
  { label: '代码执行', icon: Braces, kind: 'code' },
  { label: '等待节点', icon: Clock3, kind: 'wait' },
]

interface PublishedAgentOption {
  agentId: string
  agentName: string
  version: AgentVersion
}

export function Workflows() {
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges)
  const [workflows, setWorkflows] = useState<WorkflowDraft[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [name, setName] = useState('未命名工作流')
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [agentOptions, setAgentOptions] = useState<PublishedAgentOption[]>([])
  const [versions, setVersions] = useState<WorkflowVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [showRun, setShowRun] = useState(false)
  const [runInput, setRunInput] = useState('')
  const [runResult, setRunResult] = useState<ExecutionRun | null>(null)
  const [feedback, setFeedback] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [isBusy, setIsBusy] = useState(false)

  const onConnect = useCallback(
    (connection: Connection) => setEdges((items) => addEdge(connection, items)),
    [setEdges],
  )

  const activateWorkflow = useCallback((workflow: WorkflowDraft) => {
    const graph = fromContractGraph(workflow.nodes, workflow.edges)
    setCurrentId(workflow.id)
    setName(workflow.name)
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setSelectedNode(null)
    setFeedback('')
    setErrors([])
    void listWorkflowVersions(workflow.id).then(setVersions)
  }, [setEdges, setNodes])

  useEffect(() => {
    async function load() {
      const [savedWorkflows, agents] = await Promise.all([
        listWorkflows(),
        listAgents(),
      ])
      setWorkflows(savedWorkflows)
      if (savedWorkflows[0]) {
        activateWorkflow(savedWorkflows[0])
      }
      const versionGroups = await Promise.all(
        agents
          .filter((agent) => agent.status !== '已停用')
          .map(async (agent) => ({
            agent,
            versions: await listAgentVersions(agent.id),
          })),
      )
      setAgentOptions(versionGroups.flatMap(({ agent, versions: published }) => (
        published.map((version) => ({
          agentId: agent.id,
          agentName: agent.name,
          version,
        }))
      )))
    }
    void load()
  }, [activateWorkflow])

  const currentWorkflow = workflows.find((workflow) => workflow.id === currentId)
  const statusText = currentWorkflow
    ? `${currentWorkflow.status} · ${currentWorkflow.version}`
    : '新草稿 · 未保存'

  const saveDraft = useCallback(async () => {
    setIsBusy(true)
    setErrors([])
    try {
      const graph = toContractGraph(nodes, edges)
      const input = { name: name.trim() || '未命名工作流', ...graph }
      const saved = currentId
        ? await updateWorkflow(currentId, input)
        : await createWorkflow(input)
      setCurrentId(saved.id)
      setWorkflows((current) => {
        const exists = current.some((workflow) => workflow.id === saved.id)
        return exists
          ? current.map((workflow) => workflow.id === saved.id ? saved : workflow)
          : [saved, ...current]
      })
      setFeedback('工作流草稿已保存')
      return saved
    } catch (saveError) {
      setErrors([saveError instanceof Error ? saveError.message : '工作流保存失败'])
      return null
    } finally {
      setIsBusy(false)
    }
  }, [currentId, edges, name, nodes])

  async function publish() {
    const saved = await saveDraft()
    if (!saved) return
    setIsBusy(true)
    try {
      const validation = await validateWorkflow(saved.id)
      if (!validation.valid) {
        setErrors(validation.errors)
        return
      }
      const version = await publishWorkflow(saved.id)
      setVersions((current) => [version, ...current])
      setWorkflows((current) => current.map((workflow) => (
        workflow.id === saved.id
          ? { ...workflow, status: '已发布', version: version.version }
          : workflow
      )))
      setFeedback(`${version.version} 已发布`)
      setErrors([])
    } catch (publishError) {
      setErrors([publishError instanceof Error ? publishError.message : '工作流发布失败'])
    } finally {
      setIsBusy(false)
    }
  }

  async function executeWorkflow() {
    if (!currentId || !runInput.trim()) {
      setErrors(['请输入运行任务'])
      return
    }
    setIsBusy(true)
    setErrors([])
    setRunResult(null)
    try {
      const result = await runWorkflow(currentId, {
        input: runInput.trim(),
        version: currentWorkflow?.version,
      })
      setRunResult(result)
      setFeedback('工作流运行已完成')
    } catch (runError) {
      setErrors([runError instanceof Error ? runError.message : '工作流运行失败'])
    } finally {
      setIsBusy(false)
    }
  }

  function startNewWorkflow() {
    setCurrentId(null)
    setName('未命名工作流')
    setNodes(defaultNodes)
    setEdges(defaultEdges)
    setSelectedNode(null)
    setVersions([])
    setErrors([])
    setFeedback('')
  }

  function addNode(kind: WorkflowNodeData['kind'], label: string) {
    const id = `${kind}-${Date.now()}`
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'workflow',
        position: { x: 300 + (current.length % 3) * 260, y: 100 + Math.floor(current.length / 3) * 180 },
        data: {
          label,
          subtitle: kind === 'agent' ? '尚未绑定发布版本' : '待配置',
          kind,
          status: kind === 'agent' ? 'warning' : 'idle',
        } satisfies WorkflowNodeData,
      },
    ])
    setFeedback('节点已添加，保存草稿后持久化')
  }

  function updateSelectedNode(nextData: Record<string, unknown>) {
    if (!selectedNode) return
    setNodes((current) => current.map((node) => (
      node.id === selectedNode.id
        ? { ...node, data: { ...node.data, ...nextData } }
        : node
    )))
    setSelectedNode((current) => current ? { ...current, data: { ...current.data, ...nextData } } : current)
  }

  function removeSelectedNode() {
    if (!selectedNode) return
    setNodes((current) => current.filter((node) => node.id !== selectedNode.id))
    setEdges((current) => current.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id))
    setSelectedNode(null)
  }

  return (
    <div className="workflow-studio">
      {feedback && <div className="toast"><Check size={16} />{feedback}</div>}
      <div className="studio-toolbar">
        <div className="workflow-title">
          <button className="workflow-icon"><GitBranch size={18} /></button>
          <div>
            <input aria-label="工作流名称" value={name} onChange={(event) => setName(event.target.value)} />
            <span>{statusText}</span>
          </div>
          {workflows.length > 0 && (
            <select
              aria-label="切换工作流"
              value={currentId ?? ''}
              onChange={(event) => {
                const workflow = workflows.find((item) => item.id === event.target.value)
                if (workflow) activateWorkflow(workflow)
              }}
            >
              {currentId === null && <option value="">新草稿</option>}
              {workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}
            </select>
          )}
        </div>
        <div className="studio-actions">
          <button className="button ghost" title="新建工作流" onClick={startNewWorkflow}><FilePlus2 size={15} />新建</button>
          <button className="button ghost" title="查看版本记录" disabled={!currentId} onClick={() => setShowVersions(true)}><History size={15} />版本记录</button>
          <button
            className="button ghost"
            title="运行已发布工作流"
            disabled={!currentWorkflow || currentWorkflow.version === '未发布' || isBusy}
            onClick={() => {
              setRunResult(null)
              setShowRun(true)
            }}
          >
            <Play size={15} />运行工作流
          </button>
          <button className="button secondary" title="保存工作流草稿" disabled={isBusy} onClick={() => void saveDraft()}><Save size={15} />保存草稿</button>
          <button className="button primary" title="发布工作流版本" disabled={isBusy} onClick={() => void publish()}><Send size={15} />发布版本</button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="workflow-errors" role="alert">
          <ShieldAlert size={17} />
          <div><strong>发布前需要处理</strong>{errors.map((error) => <span key={error}>{error}</span>)}</div>
          <button className="icon-button quiet" title="关闭错误提示" onClick={() => setErrors([])}><X size={16} /></button>
        </div>
      )}

      <div className="studio-body">
        <aside className="node-palette">
          <label className="palette-search"><Search size={15} /><input placeholder="搜索节点" /></label>
          <span className="nav-section-label">基础节点</span>
          {palette.map(({ label, icon: Icon, kind }) => (
            <button key={label} className="palette-item" title={`添加${label}节点`} onClick={() => addNode(kind, label)}>
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
          <div className="canvas-status"><span className="live-dot" />{currentId ? '草稿已连接数据库' : '新草稿尚未保存'} · {nodes.length} 个节点</div>
        </div>

        {selectedNode && (
          <NodeInspector
            node={selectedNode}
            agentOptions={agentOptions}
            onClose={() => setSelectedNode(null)}
            onUpdate={updateSelectedNode}
            onDelete={removeSelectedNode}
          />
        )}
      </div>

      {showVersions && (
        <div className="dialog-backdrop">
          <section className="agent-dialog workflow-version-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-version-title">
            <header>
              <div><p className="eyebrow">IMMUTABLE SNAPSHOTS</p><h2 id="workflow-version-title">工作流版本记录</h2></div>
              <button className="icon-button quiet" title="关闭" onClick={() => setShowVersions(false)}><X size={18} /></button>
            </header>
            <div className="version-list">
              {versions.length === 0 && <div className="version-empty">尚未发布版本</div>}
              {versions.map((version) => (
                <article className="version-item" key={version.id}>
                  <div><strong>{version.version}</strong><span>{version.snapshot.nodes.length} 个节点</span></div>
                  <p>{version.snapshot.name}</p>
                  <small>{new Date(version.createdAt).toLocaleString('zh-CN')}</small>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {showRun && (
        <div className="dialog-backdrop">
          <section className="agent-dialog workflow-run-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-run-title">
            <header>
              <div><p className="eyebrow">PUBLISHED WORKFLOW</p><h2 id="workflow-run-title">运行工作流</h2></div>
              <button className="icon-button quiet" title="关闭" onClick={() => setShowRun(false)}><X size={18} /></button>
            </header>
            <label className="form-field">
              <span>运行输入</span>
              <textarea
                rows={5}
                value={runInput}
                onChange={(event) => setRunInput(event.target.value)}
                placeholder="输入本次工作流需要处理的任务"
              />
            </label>
            <div className="dialog-actions">
              <button className="button secondary" onClick={() => setShowRun(false)}>取消</button>
              <button className="button primary" disabled={isBusy} onClick={() => void executeWorkflow()}>
                <Play size={15} />开始运行
              </button>
            </div>
            {runResult && (
              <div className="agent-test-result">
                <div className="run-kpis">
                  <div><span>状态</span><strong>{runResult.status}</strong></div>
                  <div><span>Token</span><strong>{runResult.totalTokens}</strong></div>
                  <div><span>质量得分</span><strong>{runResult.score ?? '待评估'}</strong></div>
                  <div><span>耗时</span><strong>{runResult.durationMs} ms</strong></div>
                </div>
                <div className="artifact-preview"><p>{runResult.output || runResult.error}</p></div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function NodeInspector({
  node,
  agentOptions,
  onClose,
  onUpdate,
  onDelete,
}: {
  node: Node
  agentOptions: PublishedAgentOption[]
  onClose: () => void
  onUpdate: (data: Record<string, unknown>) => void
  onDelete: () => void
}) {
  const data = node.data as WorkflowNodeData & { agentId?: string; agentVersion?: string }
  const selectedAgent = data.agentId && data.agentVersion ? `${data.agentId}|${data.agentVersion}` : ''
  const isAgent = data.kind === 'agent'
  const optionsByAgent = useMemo(() => agentOptions, [agentOptions])

  return (
    <aside className="node-inspector">
      <header><div><span className="section-kicker">节点配置</span><h3>{data.label}</h3></div><button onClick={onClose}>×</button></header>
      <label className="form-field"><span>节点名称</span><input value={data.label} onChange={(event) => onUpdate({ label: event.target.value })} /></label>
      {isAgent && (
        <label className="form-field">
          <span>已发布 Agent 版本</span>
          <select
            value={selectedAgent}
            onChange={(event) => {
              const option = optionsByAgent.find((item) => `${item.agentId}|${item.version.version}` === event.target.value)
              onUpdate(option ? {
                agentId: option.agentId,
                agentVersion: option.version.version,
                subtitle: `${option.agentName} · ${option.version.version}`,
                status: 'idle',
              } : {
                agentId: undefined,
                agentVersion: undefined,
                subtitle: '尚未绑定发布版本',
                status: 'warning',
              })
            }}
          >
            <option value="">请选择已发布版本</option>
            {optionsByAgent.map((option) => (
              <option value={`${option.agentId}|${option.version.version}`} key={`${option.agentId}-${option.version.id}`}>
                {option.agentName} · {option.version.version}
              </option>
            ))}
          </select>
          {optionsByAgent.length === 0 && <small>请先在 Agent 详情页发布至少一个版本。</small>}
        </label>
      )}
      <label className="form-field"><span>节点说明</span><input value={data.subtitle} onChange={(event) => onUpdate({ subtitle: event.target.value })} /></label>
      <div className="inspector-section">
        <div><span>节点类型</span><strong>{data.kind}</strong></div>
        <div><span>持久化状态</span><strong>随草稿保存</strong></div>
        <div><span>发布约束</span><strong>{isAgent ? '必须引用版本' : 'DAG 校验'}</strong></div>
      </div>
      <button className="button danger full" onClick={onDelete}><Trash2 size={14} />删除节点</button>
    </aside>
  )
}
