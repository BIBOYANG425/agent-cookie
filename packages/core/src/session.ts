// Pairwise session IDs — docs/plan.md v0.3 §4 T0 and §5.
// sessionId = base32(HMAC-SHA256(userSecret, merchantKey)).slice(0, 8)
// merchantKey = agent.domain ?? agent.agentId, so a UCP proxy keeps the same ID across reset and re-registration.
import { createHmac } from "node:crypto";
import type { Agent } from "./types.js";

/** Crockford base32, lowercase: 0-9 a-z without i, l, o, u. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

export function merchantKeyFor(agent: Pick<Agent, "agentId" | "domain">): string {
  return agent.domain ?? agent.agentId;
}

export function deriveSessionId(userSecret: string, merchantKey: string): string {
  if (!userSecret) throw new Error("deriveSessionId: userSecret is required");
  if (!merchantKey) throw new Error("deriveSessionId: merchantKey is required");
  const mac = createHmac("sha256", userSecret).update(merchantKey, "utf8").digest();
  return base32(mac).slice(0, 8);
}
