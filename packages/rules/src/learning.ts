import { FIELDS, type Contribution } from '@agent-cookie/contract';
import { mergeLegacyCard } from './legacy-merge.js';
import { isLearningContributionMetadata, isLearningField, learningSourceId,
  type LearningCard, type LearningContribution, type LearningField, type LearningMergeOptions } from './learning-types.js';

const YEAR = 365 * 86400000;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const writers = (rows: readonly LearningContribution[]) => [...new Set(rows.map(row => row.agentId))].sort(compare);
function at(row: LearningContribution): number {
  const value = Date.parse(row.createdAt);
  if (!Number.isFinite(value)) throw new TypeError('mergeCard requires valid ISO timestamps');
  return value;
}

/** A record carrying both IDs links their namespaces; partial copies stay in the same component. */
function sourceComponents(rows: readonly LearningContribution[]) {
  const parents = new Map<string, string>();
  const root = (id: string): string => {
    let result = id;
    while (parents.has(result)) result = parents.get(result)!;
    let current = id;
    while (parents.has(current)) {
      const next = parents.get(current)!;
      parents.set(current, result);
      current = next;
    }
    return result;
  };
  for (const row of rows) {
    if (row.intentId === undefined || row.conversationId === undefined) continue;
    const intent = root(`intent:${row.intentId}`);
    const conversation = root(`conversation:${row.conversationId}`);
    if (intent !== conversation) {
      // Stable roots make alias resolution independent of input order.
      const [first, second] = [intent, conversation].sort(compare);
      parents.set(second!, first!);
    }
  }
  return (row: LearningContribution): string | undefined => {
    const id = learningSourceId(row);
    return id === undefined ? undefined : root(id);
  };
}

/**
 * TODO(contract): latest qualified value wins; a personal statement is a time barrier,
 * so replacing it requires two independent inferred sources strictly after it.
 * Inferred agreement is medium even when several independent conversations agree.
 * Card.sources remains writer agentIds; source units live in the contribution metadata.
 */
export function mergeLearningCard(input: readonly LearningContribution[], options: LearningMergeOptions): LearningCard {
  const now = Date.parse(options.now);
  if (!Number.isFinite(now)) throw new TypeError('mergeCard requires valid ISO timestamps');
  const identified = input.filter(row => isLearningField(row.field) && isLearningContributionMetadata(row))
    .filter(row => at(row) <= now);
  // Identity links outlive their support: removing a bridge must never split one source into two.
  const sourceOf = sourceComponents(identified);
  const rows = identified.filter(row => row.revokedAt === undefined);
  const personalIds = new Set(options.personalAgentIds);
  const dynamic = [...new Set(rows.map(row => row.field).filter(field => field.startsWith('pref.')))].sort(compare);
  const result: LearningCard = { card: [], candidates: [], superseded: [] };
  for (const field of [...FIELDS, ...dynamic] as LearningField[]) {
    const entries = rows.filter(row => row.field === field);
    const barrier = entries.filter(row => row.basis === 'stated' && personalIds.has(row.agentId) && now - at(row) <= YEAR)
      .sort((a, b) => at(a) - at(b) || compare(a.value, b.value) || compare(a.agentId, b.agentId) || compare(a.id, b.id)).at(-1);
    // Reuse all existing observed/stated conflict and time rules, including for pref.*.
    // The temporary field is confined to this call; ownership and provenance never change.
    const trusted = mergeLegacyCard(entries.map(row => ({ ...row, field: 'tone' } as Contribution)), options);
    const base = trusted.card[0];
    result.card.push(...trusted.card.map(row => ({ ...row, field })));
    result.candidates.push(...trusted.candidates.filter(row => row.reason !== 'inferred').map(row => ({ ...row, field })));
    result.superseded.push(...trusted.superseded.map(row => ({ ...row, field })));

    const grouped = new Map<string, LearningContribution[]>();
    for (const row of entries.filter(row => row.basis === 'inferred')) {
      grouped.set(row.value, [...(grouped.get(row.value) ?? []), row]);
    }
    const groups = [...grouped.entries()].map(([value, all]) => {
      const live = all.filter(row => now - at(row) <= YEAR);
      const known = live.filter(row => sourceOf(row) !== undefined
        && (!barrier || value === barrier.value || at(row) > at(barrier)));
      const sources = new Set(known.map(sourceOf));
      return { value, live, known, qualified: sources.size >= 2,
        latest: known.length ? Math.max(...known.map(at)) : Number.NEGATIVE_INFINITY };
    }).sort((a, b) => a.latest - b.latest || compare(a.value, b.value));
    const newest = groups.filter(group => group.qualified).at(-1);
    const winner = newest && (!base || newest.latest > Date.parse(base.lastSupportedAt)
      || (newest.latest === Date.parse(base.lastSupportedAt) && compare(newest.value, base.value) > 0)) ? newest : undefined;
    if (winner) {
      result.card = result.card.filter(row => row.field !== field);
      result.superseded = result.superseded.filter(row => row.field !== field || row.value !== winner.value)
        .map(row => row.field === field ? { ...row, supersededBy: winner.value } : row);
      if (base && base.value !== winner.value) result.superseded.push({ field, value: base.value, sources: [...base.sources],
        lastSupportedAt: base.lastSupportedAt, supersededBy: winner.value });
      const last = new Date(winner.latest).toISOString();
      const sameValue = base?.value === winner.value;
      // Confirmation refreshes support without erasing writers or downgrading still-live observed consensus.
      const sources = [...new Set([...(sameValue ? base.sources : []), ...writers(winner.known)])].sort(compare);
      result.card.push({ field, value: winner.value, confidence: sameValue ? base.confidence : 'medium', sources,
        updatedAt: last, lastSupportedAt: last, changedRecently: false });
      result.candidates = result.candidates.filter(row => row.field !== field || row.value !== winner.value);
    }
    const selectedValue = winner?.value ?? base?.value;
    for (const group of groups) {
      if (group.value === selectedValue) continue;
      if (group.qualified && selectedValue !== undefined) {
        if (!result.superseded.some(row => row.field === field && row.value === group.value)) {
          result.superseded.push({ field, value: group.value, sources: writers(group.known),
            lastSupportedAt: new Date(group.latest).toISOString(), supersededBy: selectedValue });
        }
        result.candidates = result.candidates.filter(row => row.field !== field || row.value !== group.value);
      } else if (group.live.length && !result.candidates.some(row => row.field === field && row.value === group.value)) {
        result.candidates.push({ field, value: group.value, sources: writers(group.live), reason: 'inferred' });
      }
    }
  }
  return result;
}
