import type { ConsoleSnapshot } from './model';
import { activityLabel } from './receipts';

const formatTime = (at: string | number) => new Date(at).toLocaleString('en-US', { hour12: false });

/** Newest first. Payment events get Chinese labels beside their raw names; every reason is shown as the workspace wrote it. */
export function ActivityPanel({ data }: { data: ConsoleSnapshot | null }) {
  return <section id="activity" className="panel" aria-labelledby="activity-title">
    <div className="sheet-heading"><h2 id="activity-title">Activity</h2><span>Newest first · expand for details</span></div>
    {!data || data.events.length === 0 ? <p className="empty">{!data ? 'Connect to view activity.' : 'No activity yet. Reads and changes will appear here with their results.'}</p>
      : <ol className="activity-list">{data.events.map((event) => {
        const label = activityLabel(event);
        return <li key={event.id}><details>
          <summary><div><time dateTime={event.at}>{formatTime(event.at)}</time><h3>{label.title}</h3></div><span className="activity-result">{label.result}</span><span className="reason-toggle">View details</span></summary>
          <div className="activity-detail"><dl><div><dt>Actor</dt><dd>{event.actor}</dd></div><div><dt>Object</dt><dd>{event.object || 'None'}</dd></div><div><dt>Reason</dt><dd>{event.reason || 'No additional details.'}</dd></div>
            {label.note && <div><dt>Details</dt><dd>{label.note}</dd></div>}</dl></div>
        </details></li>;
      })}</ol>}
  </section>;
}
