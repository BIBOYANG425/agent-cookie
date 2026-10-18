// The user's installed field policy — docs/commerce-analytics-plan.md Phase 1. One document per workspace user:
// the memory repo's POLICY.yaml when lane C's repo can read it, else the document the owner installed (SQLite
// `settings`), else the contract's DEFAULT_POLICY. Every read decision, grant, receipt and Tier 0 prefix is evaluated
// against `current()` and stamped with `id()`. Installing is: validate against the FLOOR (contract policyViolations),
// repo first when it can write, then SQLite, then swap — the same order every other user record follows.
// Deterministic code over data; the document is a parameter the owner supplied, never something a model decided.
import {
  DEFAULT_POLICY, evaluateRead, evaluateWrite, isField, policyAutoFields, policyId, policyPurposeFields, policyPurposesFor, policyReadMode,
  policyViolations,
  type Category, type Field, type PolicyDocument, type PolicyView, type ReadDecision, type ReadMode, type ShadowReport,
} from "@agent-cookie/contract";
import type { Store } from "../db.js";
import { fail } from "../http.js";
import { persistStrict, writeMeta, type WriteCtx } from "./context.js";

const SETTING_KEY = "policy.document";
/** How much history one shadow evaluation walks. */
const SHADOW_LIMIT = 10_000;

export class PolicyService {
  private doc: PolicyDocument = DEFAULT_POLICY;
  private docId = policyId(DEFAULT_POLICY);
  private source: PolicyView["source"] = "default";

  constructor(private ctx: WriteCtx & { store: Store }) {}

  /** Repo → SQLite → default. A stored document that fails the floor (an older floor was looser) is logged and skipped. */
  async load(userId: string): Promise<void> {
    let candidate: unknown;
    let source: PolicyView["source"] = "default";
    try {
      const fromRepo = await this.ctx.repo().readPolicy?.();
      if (fromRepo !== undefined) { candidate = fromRepo; source = "repo"; }
    } catch (err) {
      this.ctx.log({ event: "policy.load", actor: "workspace", result: "failed", reason: "repo" });
      console.error("[workspace] policy: repo read failed:", err);
    }
    if (candidate === undefined) {
      const raw = this.ctx.store.setting(userId, SETTING_KEY);
      if (raw !== undefined) {
        try { candidate = JSON.parse(raw); source = "installed"; } catch { candidate = undefined; }
      }
    }
    if (candidate !== undefined) {
      const violations = policyViolations(candidate);
      if (violations.length > 0) {
        this.ctx.log({ event: "policy.load", actor: "workspace", result: "rejected", reason: `${source} violations=${violations.length}` });
        candidate = undefined;
      }
    }
    if (candidate === undefined) { this.set(DEFAULT_POLICY, "default"); } else { this.set(candidate as PolicyDocument, source); }
    this.ctx.log({ event: "policy.load", actor: "workspace", object: this.docId, result: "ok", reason: this.source });
  }

  private set(doc: PolicyDocument, source: PolicyView["source"]): void {
    this.doc = doc;
    this.docId = policyId(doc);
    this.source = source;
  }

  current(): PolicyDocument { return this.doc; }
  id(): string { return this.docId; }
  view(): PolicyView { return { policy: structuredClone(this.doc), policyId: this.docId, source: this.source }; }

  readMode(category: Category, field: Field): ReadMode { return policyReadMode(this.doc, category, field); }
  readDecision(category: Category, field: Field, purpose?: string): ReadDecision { return evaluateRead(this.doc, category, field, purpose); }
  autoFields(category: Category): Field[] { return policyAutoFields(this.doc, category); }
  purposeFields(category: Category): Field[] { return policyPurposeFields(this.doc, category); }
  purposesFor(category: Category, field: Field): string[] { return policyPurposesFor(this.doc, category, field); }
  canWrite(category: Category, field: Field): boolean { return evaluateWrite(this.doc, category, field); }
  /** The category's writable fields in document order (GET /assistant/context `writable`). */
  writeFields(category: Category): Field[] { return [...(this.doc.write[category] ?? [])]; }

  /** PUT /personal/policy. 422 with every violation named (sections and field names, never values); nothing changes on 422. */
  async install(actor: string, userId: string, input: unknown): Promise<PolicyView> {
    const violations = policyViolations(input);
    if (violations.length > 0) fail("MISSING_FIELD", violations.join("; "));
    const doc = structuredClone(input as PolicyDocument);
    const id = policyId(doc);
    const previous = this.docId;
    const repo = this.ctx.repo();
    let source: PolicyView["source"] = "installed";
    if (repo.writePolicy) {
      await persistStrict(this.ctx, "policy", actor, (r) => r.writePolicy!(doc, writeMeta(this.ctx, actor, doc)));
      source = "repo";
    }
    this.ctx.store.setSetting(userId, SETTING_KEY, JSON.stringify(doc));
    this.set(doc, source);
    this.ctx.log({ event: "policy.set", actor, object: id, result: "ok", reason: `from=${previous} source=${source}` });
    return this.view();
  }

  /**
   * POST /personal/policy/shadow: what the candidate would have decided differently, over every receipt (what was
   * released) and every logged allowed read. Denied reads carry no field names in the log (by design) and are skipped.
   */
  shadow(userId: string, input: unknown): ShadowReport {
    const violations = policyViolations(input);
    if (violations.length > 0) fail("MISSING_FIELD", violations.join("; "));
    const candidate = input as PolicyDocument;
    const report: ShadowReport = { candidateId: policyId(candidate), currentId: this.docId, changed: [], unchanged: 0 };
    const categories = new Map<string, Category>();
    const categoryOf = (agentId: string): Category | undefined => {
      if (!categories.has(agentId)) {
        const a = this.ctx.store.agent(agentId);
        if (a) categories.set(agentId, a.category);
      }
      return categories.get(agentId);
    };
    const compare = (ref: string, kind: "receipt" | "read", category: Category, field: Field, purpose: string | undefined) => {
      const before = evaluateRead(this.doc, category, field, purpose);
      const after = evaluateRead(candidate, category, field, purpose);
      if (before === after) report.unchanged++;
      else report.changed.push({ ref, kind, field, before, after });
    };
    for (const r of this.ctx.store.receiptsForUser(userId, SHADOW_LIMIT)) {
      const c = categoryOf(r.agentId);
      if (!c) continue;
      for (const f of r.fields) compare(r.id, "receipt", c, f, r.purpose);
    }
    for (const e of this.ctx.store.fieldReadEvents(SHADOW_LIMIT)) {
      const c = categoryOf(e.actor);
      if (!c) continue;
      // reason = "<field,field> purpose=<p>[ intent=<id>]" (services/fields.ts)
      const fields = (e.reason.split(" ")[0] ?? "").split(",").filter(isField);
      const purpose = /(?:^|\s)purpose=(\S*)/.exec(e.reason)?.[1] || undefined;
      for (const f of fields) compare(e.id, "read", c, f, purpose);
    }
    return report;
  }
}
