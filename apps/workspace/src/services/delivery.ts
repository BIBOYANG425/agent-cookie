// Outbound POSTs to merchants: callbacks ({type:"introduce"|"accepted"}) and Tier 0 chat deliveries.
// Retries with backoff, never throws, never blocks other merchants (plan §4 T7). Failures go to activity.
import { buildTier0Prefix, renderTier0Prefix, type Agent, type Field, type Handshake, type MerchantCallback } from "@agent-cookie/contract";
import type { Log } from "../activity.js";
import { laneD } from "../laneD.js";

export interface PostResult { ok: boolean; attempts: number; status?: number }

const BACKOFF_MS = [200, 800, 2000];

export async function postJson(url: string, body: unknown, opts: {
  timeoutMs: number;
  attempts: number;
  sign?: () => Promise<Record<string, string> | undefined>;
}): Promise<PostResult> {
  let status: number | undefined;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.sign) {
        try {
          Object.assign(headers, await opts.sign());
        } catch {
        }
      }
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      status = res.status;
      await res.body?.cancel();
      if (res.ok) return { ok: true, attempts: i + 1, status };
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return { ok: false, attempts: i + 1, status };
    } catch {
      status = undefined;
    }
    if (i < opts.attempts - 1) await new Promise((r) => setTimeout(r, BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]));
  }
  return { ok: false, attempts: opts.attempts, status };
}

export class Delivery {
  private pending = new Set<Promise<unknown>>();
  constructor(private opts: { timeoutMs: number; attempts: number }, private log: Log) {}

  /** Fire and track; `settle()` awaits everything in flight (tests, shutdown). The tracked promise never rejects. */
  private track(p: Promise<PostResult>): Promise<PostResult> {
    const safe = p.catch((): PostResult => ({ ok: false, attempts: 0 }));
    this.pending.add(safe);
    void safe.finally(() => this.pending.delete(safe)).catch(() => undefined);
    return safe;
  }

  private safeLog(e: Parameters<Log>[0]): void {
    try {
      this.log(e);
    } catch (err) {
      console.error("[workspace] activity log failed:", err);
    }
  }

  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  callback(agent: Agent, body: MerchantCallback): Promise<PostResult> {
    if (!agent.callbackUrl) return Promise.resolve({ ok: false, attempts: 0 });
    const sign = laneD.signTapRequest ? async () => {
      const url = new URL(agent.callbackUrl!);
      const signed = await laneD.signTapRequest!({
        sessionId: body.sessionId,
        authority: url.host,
        path: url.pathname + url.search,
        tag: body.type === "accepted" ? "agent-payer-auth" : "agent-browser-auth",
      });
      return { "Signature-Input": signed.signatureInput, Signature: signed.signature };
    } : undefined;
    return this.track(postJson(agent.callbackUrl, body, { ...this.opts, ...(sign ? { sign } : {}) }).then((r) => {
      this.safeLog({ event: `callback.${body.type}`, actor: "workspace", object: agent.agentId, result: r.ok ? "ok" : "failed",
        reason: `attempts=${r.attempts}${r.status ? ` status=${r.status}` : ""}` });
      return r;
    }));
  }

  /**
   * Tier 0: the handshake as a text prefix on the first message. Values = the category's auto fields only.
   * Returns the field names whose values the prefix carried (for the receipt, which the caller writes first).
   */
  tier0Fields(agent: Agent, handshake: Handshake, values: Partial<Record<Field, string>>): Field[] {
    return buildTier0Prefix(handshake, agent.category, values).auto.map((a) => a.field);
  }

  tier0(agent: Agent, handshake: Handshake, values: Partial<Record<Field, string>>, text?: string): Promise<PostResult> {
    if (!agent.chatEndpoint) return Promise.resolve({ ok: false, attempts: 0 });
    const prefix = renderTier0Prefix(buildTier0Prefix(handshake, agent.category, values));
    const message = text ? `${prefix}\n${text}` : prefix;
    const sign = laneD.signTapRequest ? async () => {
      const url = new URL(agent.chatEndpoint!);
      const signed = await laneD.signTapRequest!({
        sessionId: handshake.sessionId,
        authority: url.host,
        path: url.pathname + url.search,
        tag: "agent-browser-auth",
      });
      return { "Signature-Input": signed.signatureInput, Signature: signed.signature };
    } : undefined;
    return this.track(postJson(agent.chatEndpoint, { session_id: handshake.sessionId, message },
      { ...this.opts, ...(sign ? { sign } : {}) }).then((r) => {
      this.safeLog({ event: "tier0.deliver", actor: "workspace", object: agent.agentId, result: r.ok ? "ok" : "failed",
        reason: `attempts=${r.attempts}${r.status ? ` status=${r.status}` : ""}` });
      return r;
    }));
  }
}
