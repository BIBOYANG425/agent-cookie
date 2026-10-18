// Owner key minting (Phase 5): the person mints keys for their own agents (a laptop agent, a kitchen speaker) without
// going through POST /agents/register. The key is returned once and never stored, logged or listed: only its hash
// is kept, next to the owner's label. Revoking stamps revoked_at on every live minted key of the agent; such a key
// answers 401 AUTH_REQUIRED from then on (Store.keyByHash). The agent, its contributions, sessions and receipts stay.
import { roleOf, type Category, type KeyView, type MintKeyResult, type RevokeKeyResult } from "@agent-cookie/contract";
import { fail } from "../http.js";
import { hashKey, mintKey } from "../ids.js";
import type { Ctx } from "./context.js";

const AGENT_ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const LABEL_MAX_BYTES = 200;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export type MintRole = "personal" | "merchant";

export class KeyService {
  constructor(private ctx: Pick<Ctx, "store" | "clock" | "log">) {}

  /** Deterministic validation of POST /owner/keys; any failure is 422 MISSING_FIELD. */
  static validate(body: Record<string, unknown>): { agentId: string; role: MintRole; label: string } {
    const { agentId, role, label } = body;
    if (typeof agentId !== "string" || !AGENT_ID.test(agentId) || agentId === "owner" || agentId.startsWith("ucp:")) {
      fail("MISSING_FIELD", "invalid agentId");
    }
    if (role !== "personal" && role !== "merchant") fail("MISSING_FIELD", "invalid role");
    if (typeof label !== "string" || label.length === 0 || Buffer.byteLength(label, "utf8") > LABEL_MAX_BYTES || CONTROL.test(label)) {
      fail("MISSING_FIELD", "invalid label");
    }
    return { agentId, role, label };
  }

  mint(actor: string, body: Record<string, unknown>): MintKeyResult {
    const { agentId, role, label } = KeyService.validate(body);
    const { store, clock } = this.ctx;
    const now = clock.nowIso();
    const key = mintKey();
    store.tx(() => {
      const existing = store.agent(agentId);
      if (existing) {
        if (roleOf(existing.category) !== role) fail("MISSING_FIELD", "agent has a different role");
      } else {
        const category: Category = role === "personal" ? "personal" : "retail";
        store.insertAgent({ agentId, name: label, category, capabilities: [], createdAt: now });
      }
      store.insertKey({ keyHash: hashKey(key), agentId, role, createdAt: now, label });
    });
    // Ids only: never the key, never its hash, never the label (the owner's words).
    this.ctx.log({ event: "key.mint", actor, object: agentId, result: "ok", reason: role });
    return { key, agentId, role, label, createdAt: now };
  }

  list(): KeyView[] {
    return this.ctx.store.mintedKeys().map((k) => {
      const v: KeyView = { agentId: k.agentId, role: k.role as MintRole, label: k.label!, createdAt: k.createdAt };
      if (k.revokedAt) v.revokedAt = k.revokedAt;
      return v;
    });
  }

  revoke(actor: string, agentId: string): RevokeKeyResult {
    const { store, clock } = this.ctx;
    if (!store.hasMintedKey(agentId)) fail("NOT_FOUND");
    const revokedAt = clock.nowIso();
    const revoked = store.revokeMintedKeys(agentId, revokedAt);
    this.ctx.log({ event: "key.revoke", actor, object: agentId, result: "ok", reason: `revoked=${revoked}` });
    return { ok: true, revokedAt, revoked };
  }
}
