import { Download, Filter, Pause, Play, RotateCcw, Search } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from '../components/StatusBadge'
import { runs } from '../data/mock'

export function Runs() {
  const [selectedId, setSelectedId] = useState(runs[0].id)
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0]

  return (
    <div className="run-layout">
      <section className="run-list panel">
        <div className="table-tools">
          <label className="field-search"><Search size={16} /><input placeholder="搜索运行实例" /></label>
          <button className="icon-button quiet" title="筛选"><Filter size={16} /></button>
        </div>
        <div className="run-list-head"><span>最近 24 小时</span><strong>{runs.length} 个实例</strong></div>
        {runs.map((run) => (
          <button key={run.id} onClick={() => setSelectedId(run.id)} className={`run-list-item ${selectedId === run.id ? 'selected' : ''}`}>
            <div><strong>{run.workflow}</strong><span className="mono">{run.id}</span></div>
            <StatusBadge status={run.status} />
            <div className="run-progress"><i style={{ width: `${run.progress}%` }} /></div>
            <small>{run.startedAt} · {run.duration}</small>
          </button>
        ))}
      </section>

      <section className="run-detail panel">
        <header className="run-detail-header">
          <div><span className="mono">{selected.id}</span><h2>{selected.workflow}</h2><p>{selected.startedAt} 启动 · 触发方式：定时任务</p></div>
          <div className="run-actions">
            <StatusBadge status={selected.status} />
            <button className="icon-button quiet" title="暂停"><Pause size={16} /></button>
            <button className="icon-button quiet" title="重新运行"><RotateCcw size={16} /></button>
            <button className="icon-button quiet" title="导出日志"><Download size={16} /></button>
          </div>
        </header>

        <div className="run-kpis">
          <div><span>总耗时</span><strong>{selected.duration}</strong></div>
          <div><span>执行进度</span><strong>{selected.progress}%</strong></div>
          <div><span>质量得分</span><strong>{selected.score ?? '待评估'}</strong></div>
          <div><span>模型成本</span><strong>{selected.cost}</strong></div>
        </div>

        <div className="timeline">
          <h3>执行时间线</h3>
          <TimelineItem icon={<Play size={14} />} title="收集用户反馈数据" meta="已完成 · 2m 18s" detail="读取 3,482 条用户评论和 196 条客服工单" status="success" />
          <TimelineItem icon={<Play size={14} />} title="需求信号提取" meta="已完成 · 4m 42s" detail="识别 38 个需求信号，聚类为 7 个机会主题" status="success" score="92" />
          <TimelineItem icon={<Play size={14} />} title={selected.currentNode} meta={selected.status === '运行中' ? '正在执行 · 5m 48s' : '已完成 · 7m 11s'} detail="并行研究 6 个主要竞品，正在验证来源可靠性" status={selected.status === '运行中' ? 'running' : 'success'} />
          <TimelineItem icon={<Play size={14} />} title="质量门禁" meta="等待上游节点" detail="准确性、完整性、洞察价值与引用完整性检查" status="idle" />
          <TimelineItem icon={<Play size={14} />} title="产品定义" meta="尚未开始" detail="生成产品定义对象并提交负责人审批" status="idle" />
        </div>
      </section>
    </div>
  )
}

function TimelineItem({ icon, title, meta, detail, status, score }: {
  icon: React.ReactNode
  title: string
  meta: string
  detail: string
  status: 'success' | 'running' | 'idle'
  score?: string
}) {
  return (
    <div className={`timeline-item ${status}`}>
      <div className="timeline-marker">{icon}</div>
      <div><strong>{title}</strong><span>{detail}</span></div>
      <small>{meta}</small>
      {score && <b>{score} 分</b>}
    </div>
  )
}
