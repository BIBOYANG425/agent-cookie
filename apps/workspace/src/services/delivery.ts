// Outbound POSTs to merchants: callbacks ({type:"introduce"|"accepted"}) and Tier 0 chat deliveries.
// Retries with backoff, never throws, never blocks other merchants (plan §4 T7). Failures go to activity.
import {
  buildTier0Prefix, renderTier0Prefix, TAP_CAPABILITY,
  type Agent, type Field, type Handshake, type MerchantCallback, type TapTag,
} from "@agent-cookie/contract";
import type { Log } from "../activity.js";
import { isJarLocked, type LaneDHooks } from "../laneD.js";

export interface PostResult { ok: boolean; attempts: number; status?: number }

const BACKOFF_MS = [200, 800, 2000];

/** Extra headers computed per attempt (TAP signatures carry a fresh nonce and time on every try). */
export type HeaderSource = () => Promise<Record<string, string>>;

export async function postJson(url: string, body: unknown, opts: { timeoutMs: number; attempts: number }, extra?: HeaderSource): Promise<PostResult> {
  let status: number | undefined;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      const signed = extra ? await extra() : {};
      const res = await fetch(url, {
        method: "POST",
        headers: { ...signed, "content-type": "application/json" },
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
  constructor(private opts: { timeoutMs: number; attempts: number }, private log: Log, private laneD: LaneDHooks = {}) {}

  /**
   * TAP (lane D): a merchant listing TAP_CAPABILITY gets every request signed with the session's pairwise jar key.
   * Locked jar or no lane D → the request goes unsigned (logged); the merchant decides whether to accept it.
   */
  private tapHeaders(agent: Agent, url: string, sessionId: string, tag: TapTag): HeaderSource | undefined {
    if (!agent.capabilities.includes(TAP_CAPABILITY)) return undefined;
    return async (): Promise<Record<string, string>> => {
      const sign = this.laneD.signTapRequest;
      if (!sign) {
        this.safeLog({ event: "tap.sign", actor: "workspace", object: agent.agentId, result: "unsigned", reason: "lane D not configured" });
        return {};
      }
      const u = new URL(url);
      try {
        // Same convention as lane D's merchant verifier: @path is what the merchant sees as req.url (path + query).
        const s = await sign({ sessionId, authority: u.host, path: u.pathname + u.search, tag });
        return { "Signature-Input": s.signatureInput, Signature: s.signature };
      } catch (err) {
        this.safeLog({ event: "tap.sign", actor: "workspace", object: agent.agentId, result: "unsigned", reason: isJarLocked(err) ? "JAR_LOCKED" : "error" });
        return {};
      }
    };
  }

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
    const tag: TapTag = body.type === "accepted" ? "agent-payer-auth" : "agent-browser-auth";
    return this.track(postJson(agent.callbackUrl, body, this.opts, this.tapHeaders(agent, agent.callbackUrl, body.sessionId, tag)).then((r) => {
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
    const tap = this.tapHeaders(agent, agent.chatEndpoint, handshake.sessionId, "agent-browser-auth");
    return this.track(postJson(agent.chatEndpoint, { session_id: handshake.sessionId, message }, this.opts, tap).then((r) => {
      this.safeLog({ event: "tier0.deliver", actor: "workspace", object: agent.agentId, result: r.ok ? "ok" : "failed",
        reason: `attempts=${r.attempts}${r.status ? ` status=${r.status}` : ""}` });
      return r;
    }));
  }
}
