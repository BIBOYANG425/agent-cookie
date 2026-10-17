// Lane D (P1) plug points. packages/auth and packages/pay set these when they are merged; until then the
// routes answer as if the feature is absent (unlock → 404, JWKS → empty), and payment_method is never released.
import type { AuthorizePayment, SignHandshake } from "@agent-cookie/contract";

export interface LaneDHooks {
  signHandshake?: SignHandshake;
  authorizePayment?: AuthorizePayment;
  /** POST /personal/unlock → @agent-cookie/auth handleUnlock. */
  handleUnlock?: (req: Request) => Promise<Response>;
  /** GET /.well-known/agent-cookie-jwks.json?sessionId= → the session's pairwise jar key. */
  jwks?: (sessionId: string) => Promise<unknown>;
}

export const laneD: LaneDHooks = {};
