import { ArrowRight, Beaker, CheckCircle2, FlaskConical, Plus, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { rubrics } from '../data/mock'

export function Evaluations() {
  return (
    <div className="page-stack">
      <section className="page-toolbar">
        <div><p>把质量标准变成可执行的门禁、评分量规和回归测试。</p></div>
        <button className="button primary"><Plus size={16} />新建评分量规</button>
      </section>

      <section className="evaluation-overview">
        <div className="evaluation-stat"><ShieldCheck size={20} /><span>在线质量门禁<strong>16</strong></span><small>覆盖 83% 生产流程</small></div>
        <div className="evaluation-stat"><FlaskConical size={20} /><span>Golden Set 样本<strong>1,248</strong></span><small>本周新增 86 条</small></div>
        <div className="evaluation-stat"><CheckCircle2 size={20} /><span>回归测试通过率<strong>94.6%</strong></span><small>较上版本 +1.8%</small></div>
        <div className="evaluation-stat"><Beaker size={20} /><span>待校准量规<strong>3</strong></span><small>人工一致性低于 85%</small></div>
      </section>

      <div className="rubric-grid">
        {rubrics.map((rubric) => (
          <article className="rubric-card" key={rubric.id}>
            <header>
              <div><span className="mono">{rubric.id} · {rubric.version}</span><h3>{rubric.name}</h3><p>适用产出物：{rubric.artifact}</p></div>
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
    </div>
  )
}
