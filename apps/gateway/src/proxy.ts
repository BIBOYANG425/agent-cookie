// The reverse proxy's rules for /u/:userId/* (contract GATEWAY_ENDPOINTS): which instance paths are never served under
// the gateway, which request headers travel to the instance and which response headers come back. The instance checks
// its own keys; the gateway only refuses what must never be reachable from outside (owner, demo, test, health).
import { ENDPOINTS } from "@agent-cookie/contract";

/** First path segments refused whatever the method. */
const REFUSED_FIRST_SEGMENTS = new Set(["owner", "demo", "test", "healthz"]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every workspace route only the owner key opens, or only a gated (demo/test) instance mounts, from the workspace
 * contract: PUT /personal/policy, POST /personal/policy/shadow, /owner/*, /demo/reset, /test/clock. The owner key never
 * leaves the gateway, so these would fail at the instance anyway; refusing them here keeps them unreachable by design.
 */
const OWNER_ROUTES = ENDPOINTS.filter((e) => e.caller === "owner" || e.gate !== undefined).map((e) => ({
  method: e.method,
  re: new RegExp(`^${e.path.toLowerCase().split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : escapeRe(seg))).join("/")}/?$`),
}));

/**
 * True when `rest` (the path after /u/:userId, still percent-encoded as received) must be refused with 404. The check
 * runs on a canonical form — percent-decoded, backslashes as slashes, repeated slashes and "." segments collapsed,
 * lowercase — so `/%6Fwner/activity`, `//owner/activity` or `/Owner/activity` are refused like `/owner/activity`.
 */
export function refusedInstancePath(method: string, rest: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return true;
  }
  if (/[\x00-\x1f\x7f]/.test(decoded)) return true;
  const segments = decoded.replace(/\\/g, "/").toLowerCase().split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) return true;
  if (segments.length === 0) return false;
  if (REFUSED_FIRST_SEGMENTS.has(segments[0]!)) return true;
  const canonical = `/${segments.join("/")}`;
  return OWNER_ROUTES.some((r) => r.method === method && r.re.test(canonical));
}

/** Request headers forwarded to the instance (everything else, cookies included, stays at the gateway). */
export const FORWARD_REQUEST_HEADERS = ["authorization", "content-type", "idempotency-key", "last-event-id", "accept"] as const;

/** Response headers passed back from the instance. */
export const FORWARD_RESPONSE_HEADERS = ["content-type", "cache-control", "retry-after"] as const;

/**
 * A body that calls `release` once when it is fully read, fails, or is cancelled (a client leaving an SSE stream), so
 * the instance counts as busy for exactly as long as a response is in flight.
 */
export function releasing(body: ReadableStream<Uint8Array>, release: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    cancel(reason) {
      release();
      return reader.cancel(reason).catch(() => undefined);
    },
  });
}
