// B60: which models produced a learned contribution (ContributionEvidence.models: the gate that let the turn be
// learned from, the extractor that produced the value). The workspace keeps it in SQLite and shows it in
// GET /personal/learned. RulesApi.mergeCard never sees it (it is no merge input, and rules that predate B60 reject
// evidence keys they do not know). The memory repo gets it only once the rules write it on the contribution line as
// the open keys `gate:` / `extractor:` (probed once per rules instance), so a write never fails because of it.
import {
  EVIDENCE_MODEL_ID_MAX,
  type Contribution, type ContributionEvidence, type EvidenceModels, type RulesApi,
} from "@agent-cookie/contract";

const MODEL_ID = new RegExp(`^[A-Za-z0-9._:/@-]{1,${EVIDENCE_MODEL_ID_MAX}}$`);

/** The learner's model ids, kept only when well-formed: they are parameters, not authority. */
export function evidenceModels(raw: unknown): EvidenceModels | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: EvidenceModels = {};
  for (const key of ["gate", "extractor"] as const) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && MODEL_ID.test(v)) out[key] = v;
  }
  return out.gate !== undefined || out.extractor !== undefined ? out : undefined;
}

/** The record without evidence.models (what RulesApi.mergeCard is given). */
export function withoutModels<T extends { evidence?: ContributionEvidence }>(c: T): T {
  if (!c.evidence?.models) return c;
  const { models: _models, ...rest } = c.evidence;
  const { evidence: _evidence, ...record } = c;
  return (Object.keys(rest).length > 0 ? { ...record, evidence: rest } : record) as T;
}

const probes = new WeakMap<RulesApi, boolean>();

/** Whether these rules write evidence.models on the contribution line as `gate:` / `extractor:` (lane C, B60). */
export function rulesKeepModels(rules: RulesApi): boolean {
  let keeps = probes.get(rules);
  if (keeps === undefined) {
    try {
      const probe: Contribution = { id: "probe-models", userId: "probe", agentId: "probe", field: "pref.color", value: "x",
        basis: "observed", createdAt: "2026-01-01T00:00:00.000Z",
        evidence: { conversationId: "probe", models: { gate: "probe/gate-1", extractor: "probe/extractor-1" } } };
      const line = rules.renderContribution(probe);
      keeps = /[[;] ?gate: probe\/gate-1[;\]]/.test(line) && /[[;] ?extractor: probe\/extractor-1[;\]]/.test(line);
    } catch {
      keeps = false;
    }
    probes.set(rules, keeps);
  }
  return keeps;
}

/** What the memory repo is given: evidence.models only when the rules keep it. */
export function forRepo<T extends { evidence?: ContributionEvidence }>(rules: RulesApi, c: T): T {
  return rulesKeepModels(rules) ? c : withoutModels(c);
}
