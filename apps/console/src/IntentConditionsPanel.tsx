import type { IntentHistoryEntry } from '../../../packages/contract/src/types';
import { FieldName } from './fields';
import './panels.css';

const formatTime = (at: string) => new Date(at).toLocaleString('zh-CN', { hour12: false });

/** public is explicit intent data. Do not infer field authorization or overwrite card defaults. */
export function IntentConditionsPanel({ intents }: { intents?: readonly IntentHistoryEntry[] | null }) {
  const rows = intents && [...intents].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return <section id="intent-conditions" className="panel" aria-labelledby="intent-conditions-title">
    <div className="sheet-heading"><h2 id="intent-conditions-title">本次请求条件</h2><span>按请求分别显示</span></div>
    <p className="panel-note">来自每条请求的显式条件；不会改写身份卡，也不代表商家已获准读取。</p>
    {intents === undefined ? <p className="empty">读取后显示本次请求条件。</p>
      : intents === null ? <p className="empty" role="status">暂时无法读取，其他视图可继续使用。</p>
        : rows?.length === 0 ? <p className="empty">还没有请求记录。</p>
          : <ol className="intent-list">{rows?.map(intent => <li className="intent-record" key={intent.id}>
            <div className="intent-heading"><h3>{intent.query || intent.text || '请求'}</h3><time dateTime={intent.createdAt}>{formatTime(intent.createdAt)}</time></div>
            <p className="small muted">{intent.id} · {intent.agentId}</p>
            {Object.keys(intent.public).length === 0 ? <p className="muted small">这条请求没有单独指定条件。</p>
              : <dl className="intent-conditions">{Object.entries(intent.public).map(([field, value]) => <div key={field}>
                <dt>{field === 'size' ? <><span className="field-label">尺码 </span><code className="field-key">size</code></> : <FieldName field={field} />}</dt>
                <dd><span className="intent-condition-value">{value || '（空值）'}</span><span className="intent-scope">本次</span></dd>
              </div>)}</dl>}
          </li>)}</ol>}
  </section>;
}
