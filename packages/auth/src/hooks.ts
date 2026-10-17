import { LaneError } from "./contract.js";
import { JarKeyStore } from "./jar-key-store.js";
import { handleUnlock as unlockJar } from "./unlock-token.js";
import type { UnlockTokenOptions } from "./unlock-token.js";

type LaneDHooksOptions = {
  jar: JarKeyStore;
  secret: Uint8Array;
  ttlMs: number;
} & Pick<UnlockTokenOptions, "now">;

function tokenBody(value: unknown): { token?: unknown } {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as { token?: unknown }
    : {};
}

export function createLaneDHooks({ jar, secret, ttlMs, now }: LaneDHooksOptions) {
  const seenNonces = new Set<string>();
  return {
    signHandshake: (handshake: Parameters<typeof jar.signHandshake>[0]) => jar.signHandshake(handshake),
    signTapRequest: (options: Parameters<typeof jar.signTapRequest>[0]) => jar.signTapRequest(options),
    handleUnlock: async (req: Request): Promise<Response> => {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          { error: { code: "MISSING_FIELD", message: "Invalid request body" } },
          { status: 400 },
        );
      }
      try {
        const result = await unlockJar({
          jar,
          secret,
          body: tokenBody(body),
          seenNonces,
          ttlMs,
          now,
        });
        return Response.json(result);
      } catch (error) {
        if (error instanceof LaneError) {
          return Response.json(error.toBody(), { status: error.status });
        }
        throw error;
      }
    },
    jwks: async (sessionId: string): Promise<unknown> => jar.jwks(sessionId),
  };
}
