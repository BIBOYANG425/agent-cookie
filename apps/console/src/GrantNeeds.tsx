import { FieldName } from './fields';
import type { ActivityEvent, GrantView } from './model';

/** Display metadata only. Never calculate authorization or infer unavailable from the card. */
export function GrantNeeds({ grant, events }: { grant: GrantView; events: readonly ActivityEvent[] }) {
  // TODO(contract): A/B must preserve kind and bind actor to this exact merchant in /owner/activity.
  const declaration = events.filter(event => event.kind === 'needs_declared' && event.actor === grant.agentId)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id))[0];
  if (!declaration || typeof declaration.object !== 'string' || !declaration.object.trim()) return null;
  const raw = grant.handshake?.unavailable;
  const unavailable = Array.isArray(raw) ? [...new Set(raw.filter((field): field is string => typeof field === 'string' && !!field))] : [];
  return <div className="grant-needs">
    <p className="small"><span className="muted">最近一次申请 · </span>{declaration.object}</p>
    {unavailable.length > 0 && <ul className="grant-fields" aria-label="握手中不可用的字段">
      {unavailable.map(field => <li className="unavailable-field" key={field}><FieldName field={field} /></li>)}
    </ul>}
  </div>;
}
