import type { ConsoleSnapshot } from './model';
import { activityLabel } from './receipts';

const formatTime = (at: string | number) => new Date(at).toLocaleString('zh-CN', { hour12: false });

/** Newest first. Payment events get Chinese labels beside their raw names; every reason is shown as the workspace wrote it. */
export function ActivityPanel({ data }: { data: ConsoleSnapshot | null }) {
  return <section id="activity" className="panel" aria-labelledby="activity-title">
    <div className="sheet-heading"><h2 id="activity-title">活动</h2><span>最新在前 · 展开查看原因</span></div>
    {!data || data.events.length === 0 ? <p className="empty">{!data ? '连接后显示活动。' : '还没有活动记录。发生读取或修改后，这里会显示结果和原因。'}</p>
      : <ol className="activity-list">{data.events.map((event) => {
        const label = activityLabel(event);
        return <li key={event.id}><details>
          <summary><div><time dateTime={event.at}>{formatTime(event.at)}</time><h3>{label.title}</h3></div><span className="activity-result">{label.result}</span><span className="reason-toggle">查看原因</span></summary>
          <div className="activity-detail"><dl><div><dt>执行者</dt><dd>{event.actor}</dd></div><div><dt>对象</dt><dd>{event.object || '无'}</dd></div><div><dt>原因</dt><dd>{event.reason || '没有额外原因说明。'}</dd></div>
            {label.note && <div><dt>说明</dt><dd>{label.note}</dd></div>}</dl></div>
        </details></li>;
      })}</ol>}
  </section>;
}
