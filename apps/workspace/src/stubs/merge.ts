// STUB of RulesApi.mergeCard (owned by lane C, packages/rules) — delete when @agent-cookie/rules is wired.
// Card merge rules — docs/plan.md v0.3 §4 T0 (merge bullet) and §5 "规模与时间规则" / "偏好会变，怎么办".
// Pure and deterministic: no IO, no system clock (`now` is injected), no model.
import {
  CARD_DECAY_MEDIUM_DAYS,
  CARD_DROP_DAYS,
  FIELDS,
  isField,
  type Candidate,
  type Card,
  type CardField,
  type Contribution,
  type Field,
  type SupersededField,
} from "@agent-cookie/contract";

export interface MergeOptions {
  /** Injected clock, ISO string. Required: pure functions never read the system clock. */
  now: string;
  /**
   * agentIds whose "stated" contributions count as personal (the user's own agent).
   * Omitted → every "stated" contribution is treated as personal (policy already forbids merchants from stating).
   */
  personalAgentIds?: string[];
}

const MS_PER_DAY = 86_400_000;

/** Signed days from `aIso` to `bIso` (b − a), fractional. Throws on an unparseable timestamp. */
export function daysBetween(aIso: string, bIso: string): number {
  return (parseIso(bIso, "bIso") - parseIso(aIso, "aIso")) / MS_PER_DAY;
}

function parseIso(iso: string, what: string): number {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) throw new Error(`mergeCard: ${what} is not an ISO timestamp: ${String(iso)}`);
  return ms;
}

/** One (field, value) group of contributions with the derived facts the rules need. */
interface Group {
  field: Field;
  value: string;
  /** basis !== "inferred" */
  supporters: Contribution[];
  /** distinct agentIds of supporters, sorted */
  sources: string[];
  /** distinct agentIds of inferred contributions, sorted */
  inferredSources: string[];
  /** max supporter createdAt; "" when there is no supporter */
  lastSupportedAt: string;
  lastSupportedMs: number;
  qualified: boolean;
  /** has a "stated" contribution from a personal agent (the user's own words) */
  personalStated: boolean;
}

/**
 * Rules (plan §4 T0 merge bullet, §5 time rules, A02, A11):
 *  - same field+value from ≥2 distinct agentIds with basis≠inferred → on card (confidence high)
 *  - personal "stated", single source → on card (confidence medium)
 *  - inferred → never on card (candidate, reason "inferred")
 *  - single non-personal source → candidate, reason "single_source"
 *  - several values for one field → newest supported value wins; older qualified values go to superseded history
 *  - a personal "stated" value is only replaced by a newer qualified value, never by a lone merchant observation
 *  - newest value with one source → medium + changedRecently
 *  - lastSupportedAt > 180 days → medium; > 365 days → dropped (kept in superseded with supersededBy "")
 *  - revoked contributions and unknown fields are ignored
 */
export function mergeCard(contributions: Contribution[], options: MergeOptions): Card {
  if (!options || typeof options.now !== "string" || options.now.length === 0) {
    throw new Error("mergeCard: options.now (ISO string) is required");
  }
  const nowMs = parseIso(options.now, "options.now");
  const personal = options.personalAgentIds ? new Set(options.personalAgentIds) : undefined;

  const card: CardField[] = [];
  const candidates: Candidate[] = [];
  const superseded: SupersededField[] = [];

  const byField = groupByField(contributions, personal);

  for (const field of FIELDS) {
    const groups = byField.get(field);
    if (!groups || groups.length === 0) continue;

    const qualifiedGroups = groups.filter((g) => g.qualified);

    if (qualifiedGroups.length === 0) {
      // Rule 4: nothing on the card; every group is a candidate.
      for (const g of sortByValue(groups)) candidates.push(toCandidate(g));
      continue;
    }

    // Rule 5: the newest supported value wins among qualified groups ∪ groups with ≥1 supporter.
    const pool = groups.filter((g) => g.qualified || g.supporters.length > 0);
    const winner = pool.reduce((best, g) => (compareForWin(g, best) > 0 ? g : best));

    const supersededGroups = qualifiedGroups.filter((g) => g !== winner);
    const others = groups.filter((g) => g !== winner && !g.qualified);

    const ageDays = (nowMs - winner.lastSupportedMs) / MS_PER_DAY;
    const dropped = ageDays > CARD_DROP_DAYS;

    if (!dropped) {
      let confidence: CardField["confidence"] = winner.sources.length >= 2 ? "high" : "medium";
      if (ageDays > CARD_DECAY_MEDIUM_DAYS) confidence = "medium";
      card.push({
        field,
        value: winner.value,
        confidence,
        sources: [...winner.sources],
        updatedAt: updatedAtOf(winner, supersededGroups),
        lastSupportedAt: winner.lastSupportedAt,
        changedRecently: winner.sources.length === 1 && supersededGroups.length > 0,
      });
    }

    const history: SupersededField[] = supersededGroups.map((g) => ({
      field,
      value: g.value,
      sources: [...g.sources],
      lastSupportedAt: g.lastSupportedAt,
      supersededBy: winner.value,
    }));
    if (dropped) {
      // Fell off the card by age: history, not card, not candidates.
      history.push({
        field,
        value: winner.value,
        sources: [...winner.sources],
        lastSupportedAt: winner.lastSupportedAt,
        supersededBy: "",
      });
    }
    superseded.push(...history.sort((a, b) => cmpString(a.value, b.value)));

    for (const g of sortByValue(others)) candidates.push(toCandidate(g));
  }

  return { card, candidates, superseded };
}

function groupByField(contributions: Contribution[], personal: Set<string> | undefined): Map<Field, Group[]> {
  // field → value → contributions (insertion order is irrelevant; output is sorted later)
  const buckets = new Map<Field, Map<string, Contribution[]>>();
  for (const c of contributions) {
    if (!c || c.revokedAt) continue; // rule 1
    if (!isField(c.field)) continue; // defensive: unknown field names never reach the card
    if (typeof c.value !== "string") continue;
    if (Number.isNaN(Date.parse(c.createdAt))) continue; // defensive: a row without a usable date cannot be ordered
    let values = buckets.get(c.field);
    if (!values) buckets.set(c.field, (values = new Map()));
    const list = values.get(c.value);
    if (list) list.push(c);
    else values.set(c.value, [c]);
  }

  const out = new Map<Field, Group[]>();
  for (const [field, values] of buckets) {
    const groups: Group[] = [];
    for (const [value, list] of values) groups.push(makeGroup(field, value, list, personal));
    out.set(field, groups);
  }
  return out;
}

function makeGroup(field: Field, value: string, list: Contribution[], personal: Set<string> | undefined): Group {
  const supporters = list.filter((c) => c.basis !== "inferred");
  const sources = distinctSorted(supporters.map((c) => c.agentId));
  const inferredSources = distinctSorted(list.filter((c) => c.basis === "inferred").map((c) => c.agentId));

  let lastSupportedAt = "";
  let lastSupportedMs = Number.NEGATIVE_INFINITY;
  for (const c of supporters) {
    const ms = Date.parse(c.createdAt);
    if (ms > lastSupportedMs || (ms === lastSupportedMs && cmpString(c.createdAt, lastSupportedAt) > 0)) {
      lastSupportedMs = ms;
      lastSupportedAt = c.createdAt;
    }
  }

  const personalStated = supporters.some(
    (c) => c.basis === "stated" && (personal === undefined || personal.has(c.agentId)),
  );
  const qualified = sources.length >= 2 || personalStated;

  return { field, value, supporters, sources, inferredSources, lastSupportedAt, lastSupportedMs, qualified, personalStated };
}

/**
 * > 0 when `a` beats `b`.
 * The user's own stated value is sticky against a single merchant observation whatever its date ("用户亲口说的立即覆盖");
 * only a newer QUALIFIED value (≥2 sources, or a newer personal statement) replaces it. Otherwise: newer lastSupportedAt,
 * then qualified, then more sources, then smaller value.
 */
function compareForWin(a: Group, b: Group): number {
  if (a.personalStated && !b.qualified) return 1;
  if (b.personalStated && !a.qualified) return -1;
  if (a.lastSupportedMs !== b.lastSupportedMs) return a.lastSupportedMs > b.lastSupportedMs ? 1 : -1;
  if (a.qualified !== b.qualified) return a.qualified ? 1 : -1;
  if (a.sources.length !== b.sources.length) return a.sources.length > b.sources.length ? 1 : -1;
  return -cmpString(a.value, b.value);
}

/**
 * When the card flipped to the winner: the earliest supporter of the winner that is later than everything it
 * superseded. With nothing superseded, the winner's earliest supporter. If no supporter is strictly later
 * (a tie on lastSupportedAt broken by the tie rules), the flip happened at lastSupportedAt.
 */
function updatedAtOf(winner: Group, supersededGroups: Group[]): string {
  const sorted = [...winner.supporters].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || cmpString(a.createdAt, b.createdAt),
  );
  if (supersededGroups.length === 0) return sorted[0]!.createdAt;
  const maxSupersededMs = Math.max(...supersededGroups.map((g) => g.lastSupportedMs));
  const first = sorted.find((c) => Date.parse(c.createdAt) > maxSupersededMs);
  return first ? first.createdAt : winner.lastSupportedAt;
}

function toCandidate(g: Group): Candidate {
  return g.supporters.length > 0
    ? { field: g.field, value: g.value, sources: [...g.sources], reason: "single_source" }
    : { field: g.field, value: g.value, sources: [...g.inferredSources], reason: "inferred" };
}

function sortByValue(groups: Group[]): Group[] {
  return [...groups].sort((a, b) => cmpString(a.value, b.value));
}

function distinctSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort(cmpString);
}

/** Code-unit order; locale-independent so output is identical on every machine. */
function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
