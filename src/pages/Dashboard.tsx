import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  Coins,
  Network,
  Play,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useWorkspace } from '../auth/WorkspaceContext'
import { metrics, reviews, runs } from '../data/mock'
import { StatusBadge } from '../components/StatusBadge'

const chart = [42, 51, 48, 62, 57, 70, 66, 74, 78, 72, 84, 86]

export function Dashboard() {
  const { workspacePath } = useWorkspace()
  return (
    <div className="dashboard page-stack">
      <section className="command-strip">
        <div>
          <span className="section-kicker">今日运行态势</span>
          <h2>86 次工作流运行，67 次全自动完成</h2>
          <p>系统整体稳定。1 个数据源异常，3 项决策正在等待人工审核。</p>
        </div>
        <div className="command-actions">
          <Link className="button secondary" to={workspacePath('runs')}><Play size={16} />查看实时运行</Link>
          <Link className="button primary" to={workspacePath('workflows')}><Network size={16} />创建工作流</Link>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-cell">
          <span><Network size={16} />活跃工作流</span>
          <strong>{metrics.activeWorkflows}</strong>
          <small>较上月 +3</small>
        </article>
        <article className="metric-cell">
          <span><Play size={16} />今日运行</span>
          <strong>{metrics.runsToday}</strong>
          <small>成功率 96.5%</small>
        </article>
        <article className="metric-cell">
          <span><Bot size={16} />自动完成率</span>
          <strong>{metrics.autoCompletionRate}%</strong>
          <small className="positive">↑ 5.2%</small>
        </article>
        <article className="metric-cell">
          <span><CheckCircle2 size={16} />平均质量分</span>
          <strong>{metrics.averageScore}</strong>
          <small className="positive">超过目标 3.6</small>
        </article>
        <article className="metric-cell">
          <span><Clock3 size={16} />本月节省工时</span>
          <strong>{metrics.savedHours}<sup>h</sup></strong>
          <small>约 39 个工作日</small>
        </article>
        <article className="metric-cell">
          <span><Coins size={16} />本月模型成本</span>
          <strong><sup>¥</sup>{metrics.monthlyCost.toLocaleString()}</strong>
          <small>单次均价 ¥ 6.18</small>
        </article>
      </section>

      <div className="dashboard-columns">
        <section className="panel performance-panel">
          <div className="panel-header">
            <div><span className="section-kicker">运行趋势</span><h3>自动完成率</h3></div>
            <div className="segmented"><button className="active">30 天</button><button>90 天</button></div>
          </div>
          <div className="chart-summary">
            <strong>78.4%</strong>
            <span>目标线 75%</span>
          </div>
          <div className="bar-chart" aria-label="近 12 周自动完成率柱状图">
            {chart.map((value, index) => (
              <div key={index} className="bar-column">
                <div className="bar" style={{ height: `${value}%` }}><span>{value}%</span></div>
              </div>
            ))}
            <i className="target-line"><span>75%</span></i>
          </div>
          <div className="chart-axis"><span>第 13 周</span><span>第 24 周</span></div>
        </section>

        <section className="panel attention-panel">
          <div className="panel-header">
            <div><span className="section-kicker">需要关注</span><h3>待办与异常</h3></div>
            <Link to={workspacePath('reviews')}>全部 <ArrowRight size={14} /></Link>
          </div>
          <div className="attention-list">
            <div className="attention-item critical">
              <ShieldAlert size={18} />
              <div><strong>1 个运行实例失败</strong><span>Amazon 数据连接器鉴权超时</span></div>
              <small>8 分钟前</small>
            </div>
            {reviews.slice(0, 2).map((review) => (
              <div className="attention-item" key={review.id}>
                <UserReviewIcon />
                <div><strong>{review.title}</strong><span>{review.workflow}</span></div>
                <small>{review.deadline}</small>
              </div>
            ))}
            <div className="attention-item">
              <Sparkles size={18} />
              <div><strong>评估集有 12 条新样本</strong><span>来自昨日人工修订记录</span></div>
              <small>待确认</small>
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div><span className="section-kicker">最近活动</span><h3>工作流运行</h3></div>
          <Link to={workspacePath('runs')}>打开运行中心 <ArrowRight size={14} /></Link>
        </div>
        <div className="data-table">
          <div className="table-row table-head">
            <span>运行实例</span><span>工作流</span><span>状态</span><span>当前节点</span><span>耗时</span><span>质量分</span>
          </div>
          {runs.slice(0, 4).map((run) => (
            <div className="table-row" key={run.id}>
              <span className="mono">{run.id}</span>
              <strong>{run.workflow}</strong>
              <span><StatusBadge status={run.status} /></span>
              <span>{run.currentNode}</span>
              <span className="mono">{run.duration}</span>
              <span className="score-value">{run.score ?? '—'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function UserReviewIcon() {
  return <div className="tiny-avatar">人</div>
}
