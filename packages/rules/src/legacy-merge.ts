import { FIELDS, type Card, type Contribution, type MergeOptions } from '@agent-cookie/contract';

const DAY_MS = 86_400_000;
const MEDIUM_AFTER_MS = 180 * DAY_MS;
const EXPIRE_AFTER_MS = 365 * DAY_MS;

type Options = Readonly<Omit<MergeOptions, 'personalAgentIds'>> & {
  readonly personalAgentIds: readonly string[];
};
type Evidence = { contribution: Contribution; at: number; personalStated: boolean };
type ValueGroup = {
  value: string;
  support: Evidence[];
  inferred: Evidence[];
  sources: string[];
  latestAt: number;
  qualifiedAt: number | undefined;
};

// Locale-independent order. Timestamps compare as instants; equal timestamps use
// UTF-16 value order, then agent/id for contribution ties. Never compare authority
// pairwise: personal > single > newer consensus > personal would form a cycle.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareEvidence(a: Evidence, b: Evidence): number {
  return a.at - b.at
    || compareText(a.contribution.value, b.contribution.value)
    || compareText(a.contribution.agentId, b.contribution.agentId)
    || compareText(a.contribution.id, b.contribution.id);
}
function compareGroups(a: ValueGroup, b: ValueGroup): number {
  return a.latestAt - b.latestAt || compareText(a.value, b.value);
}
function uniqueSources(evidence: readonly Evidence[]): string[] {
  return [...new Set(evidence.map(item => item.contribution.agentId))].sort(compareText);
}
function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new TypeError('mergeCard requires valid ISO timestamps');
  return result;
}
function groupEvidence(evidence: readonly Evidence[]): ValueGroup[] {
  const byValue = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const entries = byValue.get(item.contribution.value) ?? [];
    entries.push(item);
    byValue.set(item.contribution.value, entries);
  }
  return [...byValue.entries()].map(([value, entries]) => {
    const support = entries.filter(item => item.contribution.basis !== 'inferred').sort(compareEvidence);
    const inferred = entries.filter(item => item.contribution.basis === 'inferred');
    const seen = new Set<string>();
    // First moment at which this value qualified on its own. This is historical
    // evidence for changedRecently, not a winning-value reduction.
    const firstQualified = support.find(item => {
      seen.add(item.contribution.agentId);
      return seen.size >= 2 || item.personalStated;
    });
    return {
      value, support, inferred, sources: uniqueSources(support),
      latestAt: support.at(-1)?.at ?? Number.NEGATIVE_INFINITY,
      qualifiedAt: firstQualified?.at,
    };
  }).sort((a, b) => compareText(a.value, b.value));
}

/**
 * Select eligible values before ordering them, so input permutations cannot change
 * the winner. The latest live personal stated contribution is a fixed barrier:
 * another value needs two distinct non-inferred sources strictly AFTER that time.
 * Without a barrier, an active older consensus permits a newer single-source
 * replacement (the plan's 42 → 43 example). Expired consensus cannot bootstrap it.
 *
 * Policy clarifications agreed with lane C's coordinator pending A alignment:
 * changedRecently means a single-source value replaced an already-qualified live
 * value, not an initial personal statement or age decay. Expired qualified values
 * remain history with supersededBy='' if there is no current winner.
 */
export function mergeLegacyCard(
  contributions: readonly Contribution[],
  options: Options,
): Card {
  const now = timestamp(options.now);
  const personalIds = new Set(options.personalAgentIds);
  const evidence: Evidence[] = contributions.filter(item => item.revokedAt === undefined).map(contribution => ({
    contribution,
    at: timestamp(contribution.createdAt),
    personalStated: contribution.basis === 'stated' && personalIds.has(contribution.agentId),
  }));
  const result: Card = { card: [], candidates: [], superseded: [] };

  for (const field of FIELDS) {
    const entries = evidence.filter(item => item.contribution.field === field);
    const groups = groupEvidence(entries);
    const live = (group: ValueGroup) => now - group.latestAt <= EXPIRE_AFTER_MS;
    const barrier = entries.filter(item => item.personalStated && now - item.at <= EXPIRE_AFTER_MS)
      .sort(compareEvidence).at(-1);
    const activeConsensus = groups.filter(group => live(group) && group.sources.length >= 2);
    const eligible = groups.filter(group => {
      if (!live(group) || group.support.length === 0) return false;
      if (barrier) {
        return group.value === barrier.contribution.value
          || uniqueSources(group.support.filter(item => item.at > barrier.at)).length >= 2;
      }
      return group.qualifiedAt !== undefined
        || activeConsensus.some(older => older.latestAt < group.latestAt);
    });
    const winner = [...eligible].sort(compareGroups).at(-1);
    const eligibleSet = new Set(eligible);

    if (winner) {
      const sources = barrier && winner.value !== barrier.contribution.value
        ? uniqueSources(winner.support.filter(item => item.at > barrier.at))
        : [...winner.sources];
      const replaced = groups.some(group => group !== winner && live(group)
        && group.qualifiedAt !== undefined
        && (group.qualifiedAt < winner.latestAt
          || (group.qualifiedAt === winner.latestAt && compareText(group.value, winner.value) < 0)));
      const lastSupportedAt = new Date(winner.latestAt).toISOString();
      result.card.push({
        field, value: winner.value, sources,
        confidence: sources.length >= 2 && now - winner.latestAt <= MEDIUM_AFTER_MS ? 'high' : 'medium',
        updatedAt: lastSupportedAt, lastSupportedAt,
        changedRecently: sources.length === 1 && replaced,
      });
    }

    for (const group of groups) {
      if (group === winner) continue;
      if (group.qualifiedAt !== undefined || eligibleSet.has(group)) {
        result.superseded.push({
          field, value: group.value, sources: [...group.sources],
          lastSupportedAt: new Date(group.latestAt).toISOString(),
          supersededBy: winner?.value ?? '',
        });
      } else {
        result.candidates.push({
          field, value: group.value,
          sources: group.support.length ? [...group.sources] : uniqueSources(group.inferred),
          reason: group.support.length ? 'single_source' : 'inferred',
        });
      }
    }
  }
  return result;
}
