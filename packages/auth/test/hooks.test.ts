import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JarKeyStore, createLaneDHooks, createUnlockToken } from "../src/index.js";

describe("createLaneDHooks", () => {
  it("handles unlock, malformed JSON, replay protection, and pairwise JWKS", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-cookie-lane-d-hooks-"));
    try {
      let now = 1_000;
      const secret = Buffer.from("workspace-unlock-secret");
      const jar = JarKeyStore.open({
        path: join(directory, "jar.json"),
        kek: Buffer.alloc(32, 7),
        now: () => now,
      });
      const hooks = createLaneDHooks({ jar, secret, ttlMs: 500, now: () => now });
      const malformed = await hooks.handleUnlock(new Request("https://workspace.test/personal/unlock", {
        method: "POST",
        body: "{",
        headers: { "content-type": "application/json" },
      }));
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({
        error: { code: "MISSING_FIELD", message: "Invalid request body" },
      });

      const token = createUnlockToken(secret, { ttlMs: 500, now: () => now });
      const request = () => new Request("https://workspace.test/personal/unlock", {
        method: "POST",
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
      });
      const unlocked = await hooks.handleUnlock(request());
      expect(unlocked.status).toBe(200);
      expect(await unlocked.json()).toEqual({ unlockedUntil: 1_500 });

      const replay = await hooks.handleUnlock(request());
      expect(replay.status).toBe(401);
      expect(await replay.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });

      const jwks = await hooks.jwks("pairwise-session");
      expect(jwks).toMatchObject({ keys: [{ kid: expect.any(String), crv: "Ed25519" }] });
      now = 1_100;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
