// HTTP-only projection of A 0129f08 LearnedResponse; no SDK, rules or storage imports.
import assert from 'node:assert/strict';
export interface LearnedObservation {
  id: string; agentId: string; field: string; value: string; basis: 'inferred' | 'observed' | 'stated';
  status: 'candidate' | 'on_card'; createdAt: string; evidence?: string; revokedAt?: string;
  /** Source IDs from one evidence object; wire-level group.sources contains author agentIds instead. */
  sources: Array<{ kind: 'conversation' | 'intent'; id: string }>;
  [key: string]: unknown;
}
const prefFields = new Set(['brand', 'color', 'material', 'style', 'fit', 'avoid', 'occasion', 'recipient', 'price_band', 'size_system']
  .map(key => `pref.${key}`));
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonblank = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function noTranscript(value: Record<string, unknown>): void {
  for (const raw of ['transcript', 'messages', 'turns', 'conversationText', 'rawText', 'text', 'query', 'body']) {
    assert(!(raw in value), 'learned response must not contain raw transcript fields');
  }
}

/** A groups field/value once; normalize each evidence item without treating its two aliases as two sources. */
export function projectLearnedResponse(body: unknown): { paused: boolean; entries: LearnedObservation[] } {
  assert(record(body) && typeof body.paused === 'boolean' && Array.isArray(body.learned), 'expected paused and learned response');
  noTranscript(body);
  const entries: LearnedObservation[] = [];
  const groups = new Set<string>();
  for (const group of body.learned) {
    assert(record(group) && typeof group.field === 'string' && prefFields.has(group.field), 'learned field must be in the formal pref whitelist');
    noTranscript(group);
    assert(typeof group.value === 'string', 'learned value must be text');
    assert(group.status === 'candidate' || group.status === 'card', 'learned status must be candidate or card');
    assert(Array.isArray(group.sources) && group.sources.every(nonblank), 'group sources must be author agentIds');
    assert(Array.isArray(group.evidence) && group.evidence.length > 0, 'nonempty learned group requires evidence');
    const groupKey = JSON.stringify([group.field, group.value]);
    assert(!groups.has(groupKey), 'learned field/value groups must be unique'); groups.add(groupKey);
    for (const evidence of group.evidence) {
      assert(record(evidence), 'learned evidence must be an object');
      noTranscript(evidence);
      assert(nonblank(evidence.contributionId) && nonblank(evidence.agentId), 'evidence contribution and author identities required');
      assert(['inferred', 'observed', 'stated'].includes(String(evidence.basis)), 'evidence basis must be explicit');
      assert(validDate(evidence.createdAt), 'evidence timestamp must be valid');
      assert(evidence.snippet === undefined || (typeof evidence.snippet === 'string' && [...evidence.snippet].length <= 200), 'snippet must be at most 200 Unicode characters');
      const sources: LearnedObservation['sources'] = [];
      for (const [key, kind] of [['conversationId', 'conversation'], ['intentId', 'intent']] as const) {
        if (evidence[key] === undefined) continue;
        assert(nonblank(evidence[key]), 'evidence source must be a nonblank ID');
        sources.push({ kind, id: evidence[key] });
      }
      entries.push({ id: evidence.contributionId, agentId: evidence.agentId, field: group.field, value: group.value,
        status: group.status === 'card' ? 'on_card' : 'candidate', basis: evidence.basis as LearnedObservation['basis'],
        createdAt: evidence.createdAt, ...(evidence.snippet !== undefined ? { evidence: evidence.snippet as string } : {}), sources });
    }
  }
  assert(new Set(entries.map(entry => entry.id)).size === entries.length, 'contribution IDs must be unique');
  return { paused: body.paused, entries };
}

function sourceComponents(entries: readonly LearnedObservation[]): Map<string, number> {
  const edges = new Map<string, Set<string>>();
  for (const entry of entries) {
    const ids = entry.sources.map(source => `${source.kind}:${source.id}`);
    for (const id of ids) {
      const neighbors = edges.get(id) ?? new Set<string>();
      for (const other of ids) neighbors.add(other);
      edges.set(id, neighbors);
    }
  }
  const components = new Map<string, number>();
  for (const id of edges.keys()) {
    if (components.has(id)) continue;
    const component = components.size;
    const pending = [id];
    while (pending.length) {
      const next = pending.pop()!;
      if (components.has(next)) continue;
      components.set(next, component);
      pending.push(...edges.get(next)!);
    }
  }
  return components;
}

export function assertLearnedEvidence(entries: readonly LearnedObservation[], now: string): void {
  const at = Date.parse(now);
  assert(Number.isFinite(at), 'evidence check requires explicit now');
  const active = entries.filter(entry => !entry.revokedAt);
  assert(new Set(entries.map(entry => entry.id)).size === entries.length, 'contribution IDs must be unique');
  for (const entry of entries) {
    assert(nonblank(entry.id) && nonblank(entry.agentId) && prefFields.has(entry.field) && typeof entry.value === 'string', 'learned record identity, field and value required');
    assert(['candidate', 'on_card'].includes(entry.status), 'learned status must be explicit');
    assert(['stated', 'observed', 'inferred'].includes(entry.basis), 'learned basis must be a valid explicit enum');
    assert(Number.isFinite(Date.parse(entry.createdAt)), 'learned timestamp must be valid');
    assert(Date.parse(entry.createdAt) <= at, 'future evidence cannot count as learned');
    assert(entry.evidence === undefined || Array.from(entry.evidence).length <= 200, 'evidence must be at most 200 Unicode characters');
    noTranscript(entry);
    assert(entry.sources.every(source => ['conversation', 'intent'].includes(source.kind) && source.id.trim()), 'evidence sources must identify a conversation or intent');
  }
  // Retain revoked/expired identity links. Dropping a bridge must not split one source into two.
  const components = sourceComponents(entries);
  for (const entry of active.filter(row => row.status === 'on_card')) {
    const live = active.filter(other => other.field === entry.field && other.value === entry.value
      && at - Date.parse(other.createdAt) <= 365 * 86_400_000);
    assert(live.length > 0, 'expired evidence cannot support a card value');
    const sources = new Set(live.flatMap(other => other.sources.map(source => components.get(`${source.kind}:${source.id}`))));
    assert(live.some(other => other.basis === 'stated') || sources.size >= 2,
      'promotion requires two independent live evidence sources or a personal stated contribution');
  }
}

export function assertLearningPaused(before: readonly LearnedObservation[], after: readonly LearnedObservation[]): void {
  const prior = new Map(before.map(entry => [entry.id, entry]));
  for (const entry of after.filter(row => !row.revokedAt)) {
    const old = prior.get(entry.id);
    assert(old, 'paused learning must not add contributions');
    assert.deepEqual([entry.field, entry.value, entry.evidence, entry.createdAt, entry.sources],
      [old.field, old.value, old.evidence, old.createdAt, old.sources], 'paused learning must not replace evidence');
  }
}

export function assertLearnedRevoked(entries: readonly LearnedObservation[], id: string): void {
  assert(entries.every(entry => entry.id !== id || !!entry.revokedAt), 'revoked contribution must no longer be active');
}

/** Compare a controlled eligible pool where size/budget/other ranking factors are equal.
 * `matched` must come from verified catalog attributes, never a guessed product name. */
export function assertPreferenceRanking(eligible: readonly string[], ranked: readonly string[], matched: readonly string[]): void {
  assert(new Set(ranked).size === ranked.length && ranked.length === eligible.length
    && ranked.every(id => eligible.includes(id)), 'ranking must preserve the same eligible candidate pool');
  assert(matched.length > 0 && matched.every(id => eligible.includes(id)), 'at least one verified matched candidate is required');
  const matching = new Set(matched);
  let sawNonmatch = false;
  for (const id of ranked) {
    if (!matching.has(id)) sawNonmatch = true;
    else assert(!sawNonmatch, 'preference ranking must place verified matches before otherwise equal nonmatches');
  }
}
