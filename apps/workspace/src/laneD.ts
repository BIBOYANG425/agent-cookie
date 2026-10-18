// Lane D (P1) plug points: handshake signing, TAP request signing, jar unlock, per-session JWKS.
// createLaneD() builds them from @agent-cookie/auth when AGENT_COOKIE_JAR_KEK and AGENT_COOKIE_UNLOCK_SECRET are
// set; otherwise every hook is absent and the workspace behaves as before (unsigned handshakes, no TAP headers,
// unlock → 404, JWKS → empty). Wired but locked: a new intent fails with JAR_LOCKED (the user unlocks first, lane D);
// a delivery whose signing fails later (the unlock expired) goes out unsigned and the fallback is logged.
// `authorizePayment` and `reversePayment` are not built here: AGENT_COOKIE_PAY switches them on by itself (payments.ts,
// wired in deps.ts), so payment may be on while the jar is off. With the jar wired, the accept path's merchant requests
// carry the TAP `agent-payer-auth` signature (services/delivery.ts); UCP steps go through the `ucp` CLI and carry none.
import { resolve } from "node:path";
import type { AuthorizePayment, PaymentAuthorization, ReversePayment, SignHandshake } from "@agent-cookie/contract";
import { createLaneDHooks, JarKeyStore } from "@agent-cookie/auth";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";

/** Visa TAP tags (lane D, docs/requests.md): browsing/quoting vs accept/checkout. */
export type TapTag = "agent-browser-auth" | "agent-payer-auth";
export interface SignedTap { signatureInput: string; signature: string; keyId: string }

export interface LaneDHooks {
  signHandshake?: SignHandshake;
  /** TAP: signs `@authority` and `@path` with the session's pairwise key (RFC 9421 Signature-Input / Signature). */
  signTapRequest?: (o: { sessionId: string; authority: string; path: string; tag: TapTag }) => Promise<SignedTap>;
  authorizePayment?: AuthorizePayment;
  /** Releases the hold of an authorization the store did not take (set with authorizePayment by AGENT_COOKIE_PAY). */
  reversePayment?: ReversePayment;
  /** D1: set with authorizePayment; `simulated` when the configured provider is lane D's Visa Acceptance simulator. */
  paymentProvenance?: Pick<PaymentAuthorization, "provider" | "simulated">;
  /** POST /personal/unlock → @agent-cookie/auth handleUnlock (the unlock app's HMAC handoff token is the credential). */
  handleUnlock?: (req: Request) => Promise<Response>;
  /** GET /.well-known/agent-cookie-jwks.json?sessionId= → the session's pairwise jar key. */
  jwks?: (sessionId: string) => Promise<unknown>;
  /** Zeroes the unlocked seed (workspace shutdown). */
  lock?: () => void;
}

export function createLaneD(config: Config, clock: Clock): LaneDHooks {
  if (!config.jarKek || !config.unlockSecret) return {};
  const kek = Buffer.from(config.jarKek, "base64url");
  if (kek.length !== 32) throw new Error("AGENT_COOKIE_JAR_KEK must be a base64url-encoded 32-byte key");
  const jar = JarKeyStore.open({ path: config.jarPath ?? resolve(config.dataDir, "jar.json"), kek, now: () => clock.now() });
  const hooks = createLaneDHooks({ jar, secret: Buffer.from(config.unlockSecret), ttlMs: config.unlockTtlMs, now: () => clock.now() });
  return {
    signHandshake: hooks.signHandshake,
    signTapRequest: hooks.signTapRequest,
    handleUnlock: hooks.handleUnlock,
    jwks: hooks.jwks,
    lock: () => jar.lock(),
  };
}

/** Lane D signals a locked jar with WorkspaceError("JAR_LOCKED"). */
export function isJarLocked(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "JAR_LOCKED";
}
