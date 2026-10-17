// Lane D (P1) plug points. Auth hooks are opt-in via the jar KEK and unlock secret; payment_method stays disabled.
import type { AuthorizePayment, SignHandshake } from "@agent-cookie/contract";

export interface LaneDHooks {
  signHandshake?: SignHandshake;
  signTapRequest?: (o: {
    sessionId: string;
    authority: string;
    path: string;
    tag: "agent-browser-auth" | "agent-payer-auth";
  }) => Promise<{ signatureInput: string; signature: string; keyId: string }>;
  authorizePayment?: AuthorizePayment;
  /** POST /personal/unlock → @agent-cookie/auth handleUnlock. */
  handleUnlock?: (req: Request) => Promise<Response>;
  /** GET /.well-known/agent-cookie-jwks.json?sessionId= → the session's pairwise jar key. */
  jwks?: (sessionId: string) => Promise<unknown>;
}

export const laneD: LaneDHooks = {};
