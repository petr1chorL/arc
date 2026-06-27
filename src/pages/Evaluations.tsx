import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Beaker, CheckCircle2, FlaskConical, Plus, RefreshCw, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { getEvaluationOverview, getRubrics } from '../api/evaluations'
import { useWorkspace } from '../auth/workspaceContextState'
import type { EvaluationOverview, Rubric } from '../types'

const emptyOverview: EvaluationOverview = {
  totals: {
    feedbackCandidates: 0,
    pendingCandidates: 0,
    confirmedCandidates: 0,
    goldenSamples: 0,
    coveredWorkflows: 0,
    coveredAgents: 0,
  },
  recentCandidates: [],
}

export function Evaluations() {
  const { workspace } = useWorkspace()
  const [overview, setOverview] = useState<EvaluationOverview>(emptyOverview)
  const [rubrics, setRubrics] = useState<Rubric[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const loadAssets = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const [nextOverview, nextRubrics] = await Promise.all([
        getEvaluationOverview(workspace.id),
        getRubrics(workspace.id),
      ])
      setOverview(nextOverview)
      setRubrics(nextRubrics)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '评估资产加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [workspace.id])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  return (
    <div className="page-stack">
      <section className="page-toolbar">
        <div><p>把质量标准变成可执行的门禁、评分量规和回归测试。</p></div>
        <div className="toolbar-actions">
          <button className="button secondary" type="button" onClick={() => void loadAssets()} disabled={isLoading}>
            <RefreshCw size={16} />刷新资产
          </button>
          <button className="button primary"><Plus size={16} />新建评分量规</button>
        </div>
      </section>

      <section className="evaluation-overview">
        <div className="evaluation-stat"><ShieldCheck size={20} /><span>反馈候选<strong>{overview.totals.feedbackCandidates}</strong></span><small>人工修改沉淀池</small></div>
        <div className="evaluation-stat"><FlaskConical size={20} /><span>Golden Sample<strong>{overview.totals.goldenSamples}</strong></span><small>{overview.totals.confirmedCandidates} 条已确认</small></div>
        <div className="evaluation-stat"><CheckCircle2 size={20} /><span>覆盖工作流<strong>{overview.totals.coveredWorkflows}</strong></span><small>来自真实 Human Task</small></div>
        <div className="evaluation-stat"><Beaker size={20} /><span>待确认候选<strong>{overview.totals.pendingCandidates}</strong></span><small>{overview.totals.coveredAgents} 个 Agent 涉及</small></div>
      </section>

      <section className="panel evaluation-assets">
        <header>
          <div>
            <span className="eyebrow">EVALUATION ASSETS</span>
            <h2>评估资产概览</h2>
          </div>
          {isLoading && <span className="status-pill">同步中</span>}
          {error && <span className="status-pill danger">加载失败</span>}
        </header>
        {error && <div className="inline-feedback error" role="alert">{error}</div>}
        {!isLoading && !error && overview.recentCandidates.length === 0 && (
          <div className="table-state">暂无反馈候选。完成一次“修改后通过”，并由专家确认后，会在这里形成 Golden Sample。</div>
        )}
        {overview.recentCandidates.length > 0 && (
          <div className="evaluation-candidate-list">
            {overview.recentCandidates.map((candidate) => (
              <article key={candidate.id} className="evaluation-candidate">
                <div>
                  <span className="mono">{candidate.id}</span>
                  <h3>{candidate.reason}</h3>
                  <p>{candidate.workflowId ?? '未绑定工作流'} / {candidate.agentId ?? '未绑定 Agent'} / {candidate.sourceNodeId}</p>
                </div>
                <div className="candidate-tags">
                  <span className={`status-pill ${candidate.status === '已确认' ? 'success' : ''}`}>{candidate.status}</span>
                  {candidate.tags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <header>
          <div>
            <span className="eyebrow">RUBRIC LIBRARY</span>
            <h2>评分量规</h2>
          </div>
          {isLoading && <span className="status-pill">同步中</span>}
          {!isLoading && !error && <span className="status-pill success">{rubrics.length} 个可用</span>}
        </header>
        {!isLoading && !error && rubrics.length === 0 && (
          <div className="table-state">暂无评分量规。</div>
        )}
        {rubrics.length > 0 && (
          <div className="rubric-grid">
            {rubrics.map((rubric) => (
              <article className="rubric-card" key={rubric.id}>
                <header>
                  <div><span className="mono">{rubric.id} / {rubric.version}</span><h3>{rubric.name}</h3><p>适用产出物：{rubric.artifact}</p></div>
                  <button className="icon-button quiet" title="配置量规"><SlidersHorizontal size={17} /></button>
                </header>
                <div className="gate-rule"><ShieldCheck size={16} /><span><b>硬性门禁</b>{rubric.gate}</span></div>
                <div className="dimension-list">
                  {rubric.dimensions.map((dimension) => (
                    <div key={dimension.name}>
                      <span>{dimension.name}</span>
                      <div className="weight-track"><i style={{ width: `${dimension.weight * 3}%` }} /></div>
                      <strong>{dimension.weight}%</strong>
                    </div>
                  ))}
                </div>
                <footer>
                  <span>自动流转阈值 <strong>≥ {rubric.passScore}</strong></span>
                  <button>查看测试结果 <ArrowRight size={14} /></button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
