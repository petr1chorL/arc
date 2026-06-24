import { Bot, Boxes, Filter, MoreHorizontal, Plus, Search, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createAgent, listAgents, type CreateAgentInput } from '../api/agents'
import { AgentCreateDialog } from '../components/AgentCreateDialog'
import { StatusBadge } from '../components/StatusBadge'
import type { Agent } from '../types'

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function Agents() {
  const [query, setQuery] = useState('')
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      setAgents(await listAgents())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Agent 加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(
    () => agents.filter((agent) => `${agent.name}${agent.role}${agent.owner}`.toLowerCase().includes(query.toLowerCase())),
    [agents, query],
  )
  const onlineCount = agents.filter((agent) => agent.status === '在线').length
  const debuggingCount = agents.filter((agent) => agent.status === '调试中').length
  const averagePassRate = agents.length
    ? agents.reduce((total, agent) => total + agent.passRate, 0) / agents.length
    : 0

  async function handleCreate(input: CreateAgentInput) {
    const created = await createAgent(input)
    setAgents((current) => [created, ...current])
  }

  return (
    <div className="page-stack">
      <section className="page-toolbar">
        <div>
          <p>集中管理 Agent 的能力、工具、版本、质量表现和发布状态。</p>
        </div>
        <button className="button primary" onClick={() => setIsCreateOpen(true)}>
          <Plus size={16} />新建 Agent
        </button>
      </section>

      <section className="summary-ribbon">
        <div><Bot size={18} /><span>Agent 总数<strong>{agents.length}</strong></span></div>
        <div><Boxes size={18} /><span>生产中<strong>{onlineCount}</strong></span></div>
        <div><Wrench size={18} /><span>调试中<strong>{debuggingCount}</strong></span></div>
        <div>
          <span className="quality-ring">{Math.round(averagePassRate)}</span>
          <span>平均通过率<strong>{averagePassRate.toFixed(1)}%</strong></span>
        </div>
      </section>

      <section className="panel">
        <div className="table-tools">
          <label className="field-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Agent" /></label>
          <button className="button ghost"><Filter size={15} />筛选</button>
        </div>
        <div className="agent-table">
          <div className="agent-row agent-head">
            <span>Agent</span><span>状态</span><span>模型 / 版本</span><span>质量表现</span><span>运行次数</span><span>负责人</span><span />
          </div>
          {isLoading && <div className="table-state">正在加载 Agent…</div>}
          {loadError && (
            <div className="table-state error" role="alert">
              <span>{loadError}</span>
              <button className="button ghost" onClick={() => void load()}>重试</button>
            </div>
          )}
          {!isLoading && !loadError && filtered.length === 0 && (
            <div className="table-state">暂无 Agent，创建第一个可复用能力。</div>
          )}
          {filtered.map((agent) => (
            <div className="agent-row" key={agent.id}>
              <div className="agent-identity">
                <div className="agent-symbol"><Bot size={18} /></div>
                <div><Link className="agent-name-link" to={`/agents/${agent.id}`}><strong>{agent.name}</strong></Link><span>{agent.role}</span></div>
              </div>
              <span><StatusBadge status={agent.status} /></span>
              <div><strong>{agent.model}</strong><span className="mono">{agent.version}</span></div>
              <div className="quality-cell">
                <strong>{agent.passRate}%</strong>
                <div className="mini-progress"><i style={{ width: `${agent.passRate}%` }} /></div>
              </div>
              <span className="mono">{agent.runs.toLocaleString()}</span>
              <div><strong>{agent.owner}</strong><span>{formatUpdatedAt(agent.updatedAt)}</span></div>
              <button className="icon-button quiet" title="更多操作"><MoreHorizontal size={17} /></button>
              <div className="agent-tools">
                {agent.tools.map((tool) => <span key={tool}>{tool}</span>)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <AgentCreateDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  )
}
