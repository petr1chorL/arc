import { Check, ChevronRight, Clock3, FileText, RotateCcw, UserCheck, X } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from '../components/StatusBadge'
import { reviews } from '../data/mock'

export function Reviews() {
  const [selectedId, setSelectedId] = useState(reviews[0].id)
  const [message, setMessage] = useState('')
  const selected = reviews.find((review) => review.id === selectedId) ?? reviews[0]

  const act = (action: string) => {
    setMessage(`已${action}「${selected.title}」`)
    window.setTimeout(() => setMessage(''), 2400)
  }

  return (
    <div className="review-layout">
      {message && <div className="toast"><Check size={16} />{message}</div>}
      <section className="review-queue panel">
        <div className="queue-heading">
          <div><span className="section-kicker">我的队列</span><h3>待审核任务</h3></div>
          <span className="queue-count">3</span>
        </div>
        <div className="queue-tabs"><button className="active">待处理 2</button><button>处理中 1</button><button>已完成</button></div>
        {reviews.map((review) => (
          <button className={`review-item ${selectedId === review.id ? 'selected' : ''}`} key={review.id} onClick={() => setSelectedId(review.id)}>
            <div className="review-item-top"><StatusBadge status={review.risk} /><small>{review.id}</small></div>
            <strong>{review.title}</strong>
            <span>{review.workflow}</span>
            <div><Clock3 size={14} />{review.deadline}<ChevronRight size={15} /></div>
          </button>
        ))}
      </section>

      <section className="review-detail panel">
        <header>
          <div><span className="mono">{selected.id}</span><h2>{selected.title}</h2><p>{selected.workflow} / {selected.node}</p></div>
          <div className="review-score"><span>AI 评分</span><strong>{selected.score}</strong><small>需人工复核</small></div>
        </header>

        <div className="review-notice">
          <UserCheck size={19} />
          <div><strong>为什么需要你判断</strong><span>{selected.reason}</span></div>
        </div>

        <div className="review-section">
          <div className="review-section-title"><FileText size={16} /><h3>Agent 产出</h3><button>查看完整产出</button></div>
          <div className="artifact-preview">
            <span>机会主题 #03</span>
            <h4>差旅场景下的多设备快速补能需求</h4>
            <p>来自 428 条用户反馈的共同信号。高频用户在机场、酒店及共享办公空间面临多设备同时充电时的接口不足与携带负担。</p>
            <div className="evidence-row">
              <span>证据强度 <strong>86</strong></span>
              <span>市场潜力 <strong>74</strong></span>
              <span>战略匹配 <strong>82</strong></span>
            </div>
          </div>
        </div>

        <div className="review-section">
          <div className="review-section-title"><h3>评估扣分项</h3></div>
          <div className="deduction"><span>-8</span><div><strong>细分市场边界不清晰</strong><p>“高频差旅用户”未给出频次标准，影响市场规模计算。</p></div></div>
          <div className="deduction"><span>-5</span><div><strong>竞品覆盖不足</strong><p>缺少两个近期进入该场景的新品牌。</p></div></div>
        </div>

        <label className="review-comment">
          <span>审核意见</span>
          <textarea placeholder="填写判断依据，修改内容将沉淀为后续评估样本…" />
        </label>

        <footer className="review-footer">
          <button className="button danger" onClick={() => act('驳回')}><X size={16} />驳回</button>
          <button className="button secondary" onClick={() => act('退回重跑')}><RotateCcw size={16} />修改后重跑</button>
          <button className="button primary" onClick={() => act('通过')}><Check size={16} />通过并继续</button>
        </footer>
      </section>
    </div>
  )
}
