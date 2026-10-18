import type { IntentHistoryEntry, Receipt } from '../../../packages/contract/src/types';

/** Join recorded receipts to their requesting assistants; never infer continuity from names alone. */
export function sharedSessions(intents: readonly IntentHistoryEntry[], receipts: readonly Receipt[]) {
  const agents = new Map(intents.map(intent => [intent.id, intent.agentId]));
  const groups = new Map<string, { merchant: string; session: string; assistants: Set<string>; requests: Set<string> }>();
  for (const receipt of receipts) {
    const assistant = receipt.intentId && agents.get(receipt.intentId);
    if (!assistant || !receipt.intentId) continue;
    const key = `${receipt.agentId}\0${receipt.sessionId}`;
    const group = groups.get(key) ?? { merchant: receipt.agentId, session: receipt.sessionId, assistants: new Set<string>(), requests: new Set<string>() };
    group.assistants.add(assistant); group.requests.add(receipt.intentId); groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.assistants.size > 1);
}

export function ContinuityPanel({ intents, receipts, sample }: { intents?: readonly IntentHistoryEntry[] | null; receipts?: readonly Receipt[] | null; sample: boolean }) {
  if (!intents || !receipts) return null;
  const sessions = sharedSessions(intents, receipts);
  if (!sessions.length) return null;
  return <section className="panel continuity-panel" aria-labelledby="continuity-title">
    <div className="sheet-heading"><div><p className="eyebrow">ASSISTANT CONTINUITY</p><h2 id="continuity-title">New assistant. Same connection.</h2></div><span>{sample ? 'Sample · ' : ''}Verified from access receipts</span></div>
    <p className="panel-note">Different assistants reached these merchants through the same session. Your connection continues across assistants.</p>
    <div className="continuity-grid">{sessions.map(group => <article key={`${group.merchant}:${group.session}`}>
      <h3>{group.merchant.replace(/^ucp:/u, '')}</h3>
      <p><strong>{group.assistants.size} assistants</strong><span className="muted"> · same merchant session</span></p>
      <code className="session-id">{group.session}</code>
      <details><summary>View matching records</summary><p>Assistants: {[...group.assistants].join(', ')}</p><p>Requests: {[...group.requests].join(', ')}</p></details>
    </article>)}</div>
    <p className="panel-note">Session continuity does not mean a merchant read a note or completed an order.</p>
  </section>;
}
