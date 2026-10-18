// Phase 4 operator funnel (contract gateway.ts OperatorFunnel): the per-row counts the gateway keeps of each person's
// owner funnel (GET /owner/funnel on their instance), the strict check of an instance's report, and the aggregate
// across persons. Counts and ids only: no intent id, no timestamp, no field name and never a field value is kept.
import type { OperatorFunnel } from "@agent-cookie/contract";

/** One intent of a person, reduced to what the aggregate needs. */
export interface FunnelCounts {
  /** The instance agent id that created the intent (absent on legacy rows). */
  createdBy?: string;
  quoted: number;
  accepted: boolean;
  questionsSkipped: number;
}

/** The instance is asked for at most this many rows (the owner route's maximum; newest first). */
export const FUNNEL_READ_LIMIT = 1000;
const MAX_ID = 128;

const count = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;

/** One row, strictly: integers ≥ 0, a boolean, an optional id of at most 128 characters; undefined when malformed. */
export function countsOf(x: unknown): FunnelCounts | undefined {
  if (!x || typeof x !== "object" || Array.isArray(x)) return undefined;
  const r = x as Record<string, unknown>;
  if (!count(r.quoted) || typeof r.accepted !== "boolean") return undefined;
  if (r.questionsSkipped !== undefined && !count(r.questionsSkipped)) return undefined;
  if (r.createdBy !== undefined && (typeof r.createdBy !== "string" || r.createdBy.length === 0 || r.createdBy.length > MAX_ID)) return undefined;
  return {
    ...(r.createdBy !== undefined ? { createdBy: r.createdBy as string } : {}),
    quoted: r.quoted,
    accepted: r.accepted,
    questionsSkipped: (r.questionsSkipped as number | undefined) ?? 0,
  };
}

/** An array of rows; undefined when it is not one or any row is malformed (a malformed report is a failed read). */
export function countsList(x: unknown): FunnelCounts[] | undefined {
  if (!Array.isArray(x) || x.length > FUNNEL_READ_LIMIT) return undefined;
  const out: FunnelCounts[] = [];
  for (const row of x) {
    const c = countsOf(row);
    if (!c) return undefined;
    out.push(c);
  }
  return out;
}

/** An instance's FunnelReport body → its rows' counts; undefined when malformed. */
export function parseFunnelReport(body: unknown): FunnelCounts[] | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  return countsList((body as { rows?: unknown }).rows);
}

export const PERSONAL_GROUP = { agentId: "personal", agentName: "The person's own agents" } as const;

export type FunnelSource = { source: "live" | "snapshot"; rows: FunnelCounts[] } | { source: "missing" };

export interface AssistantMapping {
  userId: string;
  instanceAgentId: string;
  agentId: string;
  agentName: string;
}

/**
 * Sums across persons. A missing person contributes nothing but its coverage count. Rows are grouped by the GLOBAL
 * assistant their creator maps to through the person's gateway links; every other creator (the person's own agents,
 * legacy rows without one) is the "personal" group.
 */
export function aggregateFunnel(
  persons: Array<{ userId: string } & FunnelSource>,
  mapping: AssistantMapping[],
  generatedAt: string,
): OperatorFunnel {
  const toGlobal = new Map<string, { agentId: string; agentName: string }>();
  for (const m of mapping) toGlobal.set(`${m.userId}\u0000${m.instanceAgentId}`, { agentId: m.agentId, agentName: m.agentName });
  const groups = new Map<string, OperatorFunnel["byAssistant"][number]>();
  const funnel: OperatorFunnel = {
    generatedAt,
    measured: true,
    persons: persons.length,
    coverage: { live: 0, snapshot: 0, missing: 0 },
    intents: 0,
    quoted: 0,
    accepted: 0,
    questionsSkipped: 0,
    byAssistant: [],
    // The owner funnel has no per-merchant breakdown (FunnelRow.quoted is a distinct count): nothing to report here.
    byMerchant: [],
  };
  for (const p of persons) {
    funnel.coverage![p.source]++;
    if (p.source === "missing") continue;
    for (const row of p.rows) {
      funnel.intents++;
      if (row.quoted >= 1) funnel.quoted++;
      if (row.accepted) funnel.accepted++;
      funnel.questionsSkipped += row.questionsSkipped;
      const who = (row.createdBy !== undefined ? toGlobal.get(`${p.userId}\u0000${row.createdBy}`) : undefined) ?? PERSONAL_GROUP;
      let g = groups.get(who.agentId);
      if (!g) {
        g = { agentId: who.agentId, agentName: who.agentName, intents: 0, accepted: 0, questionsSkipped: 0 };
        groups.set(who.agentId, g);
      }
      g.intents++;
      if (row.accepted) g.accepted++;
      g.questionsSkipped += row.questionsSkipped;
    }
  }
  funnel.byAssistant = [...groups.values()].sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
  return funnel;
}
