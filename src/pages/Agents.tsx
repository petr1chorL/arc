import { Bot, Boxes, Filter, MoreHorizontal, Plus, Search, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { StatusBadge } from '../components/StatusBadge'
import { agents } from '../data/mock'

export function Agents() {
  const [query, setQuery] = useState('')
  const filtered = useMemo(
    () => agents.filter((agent) => `${agent.name}${agent.role}${agent.owner}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  )

  return (
    <div className="page-stack">
      <section className="page-toolbar">
        <div>
          <p>集中管理 Agent 的能力、工具、版本、质量表现和发布状态。</p>
        </div>
        <button className="button primary"><Plus size={16} />新建 Agent</button>
      </section>

      <section className="summary-ribbon">
        <div><Bot size={18} /><span>Agent 总数<strong>24</strong></span></div>
        <div><Boxes size={18} /><span>生产中<strong>18</strong></span></div>
        <div><Wrench size={18} /><span>调试中<strong>5</strong></span></div>
        <div><span className="quality-ring">91</span><span>平均通过率<strong>91.3%</strong></span></div>
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
          {filtered.map((agent) => (
            <div className="agent-row" key={agent.id}>
              <div className="agent-identity">
                <div className="agent-symbol"><Bot size={18} /></div>
                <div><strong>{agent.name}</strong><span>{agent.role}</span></div>
              </div>
              <span><StatusBadge status={agent.status} /></span>
              <div><strong>{agent.model}</strong><span className="mono">{agent.version}</span></div>
              <div className="quality-cell">
                <strong>{agent.passRate}%</strong>
                <div className="mini-progress"><i style={{ width: `${agent.passRate}%` }} /></div>
              </div>
              <span className="mono">{agent.runs.toLocaleString()}</span>
              <div><strong>{agent.owner}</strong><span>{agent.updatedAt}</span></div>
              <button className="icon-button quiet" title="更多操作"><MoreHorizontal size={17} /></button>
              <div className="agent-tools">
                {agent.tools.map((tool) => <span key={tool}>{tool}</span>)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
