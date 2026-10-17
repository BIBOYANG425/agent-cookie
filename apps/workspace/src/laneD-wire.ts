import { resolve } from "node:path";
import { createLaneDHooks, JarKeyStore } from "@agent-cookie/auth";
import type { Config } from "./config.js";
import { laneD } from "./laneD.js";

export function wireLaneD(config: Config): (() => void) | undefined {
  const { jarKek, unlockSecret } = config;
  if (jarKek === undefined && unlockSecret === undefined) return undefined;
  if (!jarKek || !unlockSecret) {
    throw new Error("AGENT_COOKIE_JAR_KEK and AGENT_COOKIE_UNLOCK_SECRET must be set together");
  }

  const kek = Buffer.from(jarKek, "base64url");
  if (kek.length !== 32) throw new Error("AGENT_COOKIE_JAR_KEK must decode to exactly 32 bytes");
  const jar = JarKeyStore.open({ path: resolve(config.dataDir, "jar.json"), kek });
  Object.assign(laneD, createLaneDHooks({ jar, secret: Buffer.from(unlockSecret), ttlMs: config.unlockTtlMs }));

  return () => {
    delete laneD.signHandshake;
    delete laneD.signTapRequest;
    delete laneD.handleUnlock;
    delete laneD.jwks;
    jar.lock();
  };
}
