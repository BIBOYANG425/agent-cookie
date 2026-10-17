// Tier-0 text rendering of the handshake: the only form that works in the least capable harness.
import type { Handshake } from "./types.js";

export function renderHandshakePrefix(h: Handshake): string {
  return `[agent-cookie v${h.v}] session ${h.sessionId} · jar ${h.jar} · lang ${h.lang} · tone ${h.tone} · length ${h.length} · available: ${h.available.join(", ")} · expires ${h.expiresAt}`;
}
