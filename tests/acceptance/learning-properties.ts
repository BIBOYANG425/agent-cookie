// TODO(contract): normalized observations, not a declaration of the workspace wire API.
import assert from 'node:assert/strict';
export interface LearnedObservation {
  id: string; field: string; value: string; basis: 'inferred' | 'observed' | 'stated';
  status: 'candidate' | 'on_card'; createdAt: string; evidence?: string; revokedAt?: string;
  sources: Array<{ kind: 'conversation' | 'intent'; id: string }>;
  [key: string]: unknown;
}
export function assertLearnedEvidence(entries: readonly LearnedObservation[], now: string): void {
  const at = Date.parse(now);
  assert(Number.isFinite(at), 'evidence check requires explicit now');
  const active = entries.filter(entry => !entry.revokedAt);
  assert(new Set(entries.map(entry => entry.id)).size === entries.length, 'contribution IDs must be unique');
  for (const entry of entries) {
    assert(entry.id && entry.field && typeof entry.value === 'string', 'learned record identity and value required');
    assert(['candidate', 'on_card'].includes(entry.status), 'learned status must be explicit');
    assert(['stated', 'observed', 'inferred'].includes(entry.basis), 'learned basis must be a valid explicit enum');
    assert(Number.isFinite(Date.parse(entry.createdAt)), 'learned timestamp must be valid');
    assert(Date.parse(entry.createdAt) <= at, 'future evidence cannot count as learned');
    assert(entry.evidence === undefined || Array.from(entry.evidence).length <= 200, 'evidence must be at most 200 Unicode characters');
    for (const raw of ['transcript', 'messages', 'conversationText', 'rawText']) {
      assert(!(raw in entry), 'learned response must not contain raw transcript fields');
    }
    assert(entry.sources.every(source => ['conversation', 'intent'].includes(source.kind) && source.id.trim()), 'evidence sources must identify a conversation or intent');
    if (entry.revokedAt || entry.status !== 'on_card') continue;
    assert(at - Date.parse(entry.createdAt) <= 365 * 86_400_000, 'expired contribution cannot be shown on card');
    if (entry.basis === 'inferred') {
      const sourceIds = new Set(active.filter(other => other.field === entry.field && other.value === entry.value
        && Date.parse(other.createdAt) <= at && at - Date.parse(other.createdAt) <= 365 * 86_400_000)
        .flatMap(other => other.sources.map(source => `${source.kind}:${source.id}`)));
      assert(sourceIds.size >= 2, 'inferred promotion requires two independent live evidence sources');
    }
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
