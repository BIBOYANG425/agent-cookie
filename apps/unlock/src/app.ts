import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  createUnlockToken,
  JarKeyStore,
  LaneError,
  type Handshake,
} from "@agent-cookie/auth";

const require = createRequire(import.meta.url);
const OWNER_ID = Buffer.from("agent-cookie-jar-owner");
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface StoredCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports: string[];
}

interface Challenge {
  purpose: "register" | "authenticate";
  expiresAt: number;
}

export interface UnlockConfig {
  port: number;
  rpId: string;
  origin: string;
  ttlMs: number;
  dataDir: string;
  allowRegister: boolean;
  dev: boolean;
  agentCookieUrl?: string;
  agentCookieKey?: string;
  unlockSecret?: Uint8Array;
  jarKek?: Uint8Array;
}

export interface UnlockDependencies {
  verifyRegistrationResponse?: typeof verifyRegistrationResponse;
  verifyAuthenticationResponse?: typeof verifyAuthenticationResponse;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function parseEnvInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): UnlockConfig {
  const encodedKek = env.AGENT_COOKIE_JAR_KEK;
  return {
    port: parseEnvInteger(env.PORT, 4312),
    rpId: env.UNLOCK_RP_ID || "localhost",
    origin: env.UNLOCK_ORIGIN || "http://localhost:4312",
    ttlMs: parseEnvInteger(env.UNLOCK_TTL_MS, 900_000),
    dataDir: env.UNLOCK_DATA_DIR || "apps/unlock/.data",
    allowRegister: env.UNLOCK_ALLOW_REGISTER === "1",
    dev: env.UNLOCK_DEV === "1",
    agentCookieUrl: env.AGENT_COOKIE_URL || undefined,
    agentCookieKey: env.AGENT_COOKIE_KEY || undefined,
    unlockSecret: env.AGENT_COOKIE_UNLOCK_SECRET
      ? Buffer.from(env.AGENT_COOKIE_UNLOCK_SECRET)
      : undefined,
    jarKek: encodedKek ? Buffer.from(encodedKek, "base64url") : undefined,
  };
}

function resolveBrowserBundle(): string {
  const candidates = [
    "@simplewebauthn/browser/dist/bundle/index.umd.min.js",
    "@simplewebauthn/browser/dist/bundle/index.umd.js",
  ];
  for (const candidate of candidates) {
    try {
      const path = require.resolve(candidate);
      if (existsSync(path)) return path;
    } catch {
      continue;
    }
  }
  const entry = require.resolve("@simplewebauthn/browser");
  const entryDir = dirname(entry);
  for (const relativePath of [
    "../dist/bundle/index.umd.min.js",
    "../dist/bundle/index.umd.js",
    "index.umd.min.js",
    "index.umd.js",
  ]) {
    const path = join(entryDir, relativePath);
    if (existsSync(path)) return path;
  }
  throw new Error("@simplewebauthn/browser UMD bundle was not found");
}

function standaloneKek(dataDir: string): Buffer {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, "kek");
  if (!existsSync(path)) {
    const generated = randomBytes(32);
    try {
      writeFileSync(path, generated, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    generated.fill(0);
  }
  const kek = readFileSync(path);
  if (kek.length !== 32) throw new Error("Standalone KEK file must contain 32 bytes");
  return kek;
}

function readCredentials(path: string): StoredCredential[] {
  if (!existsSync(path)) return [];
  const credentials = JSON.parse(readFileSync(path, "utf8")) as StoredCredential[];
  return Array.isArray(credentials) ? credentials : [];
}

function saveCredentials(path: string, credentials: StoredCredential[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
}

function responseChallenge(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const responseBody = response as { response?: { clientDataJSON?: unknown } };
  if (typeof responseBody.response?.clientDataJSON !== "string") return undefined;
  try {
    const clientData = JSON.parse(
      Buffer.from(responseBody.response.clientDataJSON, "base64url").toString("utf8"),
    ) as { challenge?: unknown };
    return typeof clientData.challenge === "string" ? clientData.challenge : undefined;
  } catch {
    return undefined;
  }
}

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f5f1e9">
  <title>Unlock Agent Cookie</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f1e9; color: #19251f; }
    main { box-sizing: border-box; width: min(100% - 32px, 440px); padding: 32px; background: #fffdf8; border: 1px solid #d9dfd4; border-radius: 24px; box-shadow: 0 18px 50px #253a2812; }
    h1 { margin: 0 0 10px; font-size: 1.8rem; }
    p { color: #526258; line-height: 1.55; }
    .actions { display: grid; gap: 12px; margin-top: 28px; }
    button { min-height: 54px; border: 0; border-radius: 13px; background: #1e5a43; color: white; font: inherit; font-weight: 650; cursor: pointer; }
    button.secondary { background: #e2eee6; color: #1e5a43; }
    button:disabled { opacity: .55; cursor: wait; }
    #status { min-height: 1.5em; margin: 20px 0 0; font-size: .95rem; }
  </style>
</head>
<body>
  <main>
    <h1>Unlock your jar</h1>
    <p>Your passkey unlocks the signing key on this device. The key stays encrypted at rest.</p>
    <div class="actions">
      <button class="secondary" id="register">Register passkey</button>
      <button id="unlock">Unlock jar</button>
    </div>
    <p id="status" role="status" aria-live="polite">Ready.</p>
  </main>
  <script src="/vendor/webauthn.js"></script>
  <script>
    const status = document.getElementById("status");
    const buttons = [...document.querySelectorAll("button")];
    async function post(path, body) {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Request failed");
      return result;
    }
    async function run(action) {
      buttons.forEach(button => button.disabled = true);
      status.textContent = "Waiting for passkey…";
      try { status.textContent = await action(); }
      catch (error) { status.textContent = error.message || "Request failed"; }
      finally { buttons.forEach(button => button.disabled = false); }
    }
    document.getElementById("register").addEventListener("click", () => run(async () => {
      const options = await post("/webauthn/register/options");
      const response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
      await post("/webauthn/register/verify", { response });
      return "Passkey registered.";
    }));
    document.getElementById("unlock").addEventListener("click", () => run(async () => {
      const options = await post("/webauthn/authenticate/options");
      const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
      const result = await post("/webauthn/authenticate/verify", { response });
      return "Jar unlocked until " + new Date(result.unlockedUntil).toLocaleTimeString() + ".";
    }));
  </script>
</body>
</html>`;

export function createApp(config: UnlockConfig, deps: UnlockDependencies = {}): Hono {
  if (config.agentCookieUrl && !config.unlockSecret) {
    throw new Error("AGENT_COOKIE_UNLOCK_SECRET is required in workspace mode");
  }
  const now = deps.now ?? Date.now;
  const verifyRegistration = deps.verifyRegistrationResponse ?? verifyRegistrationResponse;
  const verifyAuthentication = deps.verifyAuthenticationResponse ?? verifyAuthenticationResponse;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const credentialsPath = join(config.dataDir, "credentials.json");
  const credentials = readCredentials(credentialsPath);
  const challenges = new Map<string, Challenge>();
  const vendorScript = readFileSync(resolveBrowserBundle());
  const jar = config.agentCookieUrl
    ? undefined
    : JarKeyStore.open({
        path: join(config.dataDir, "jar.json"),
        kek: config.jarKek ?? standaloneKek(config.dataDir),
        now,
      });

  const app = new Hono();
  app.get("/", (c) => c.html(page));
  app.get("/vendor/webauthn.js", (c) => {
    c.header("content-type", "application/javascript; charset=utf-8");
    return c.body(vendorScript);
  });

  app.post("/webauthn/register/options", async (c) => {
    if (credentials.length > 0 && !config.allowRegister) {
      return c.json({ error: { code: "SCOPE_DENIED", message: "Registration is disabled" } }, 403);
    }
    const options = await generateRegistrationOptions({
      rpName: "Agent Cookie",
      rpID: config.rpId,
      userID: OWNER_ID,
      userName: "jar-owner",
      userDisplayName: "Agent Cookie jar owner",
      attestationType: "none",
      excludeCredentials: credentials.map((credential) => ({
        id: credential.id,
        transports: credential.transports as never[],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    });
    challenges.set(options.challenge, {
      purpose: "register",
      expiresAt: now() + CHALLENGE_TTL_MS,
    });
    return c.json(options);
  });

  app.post("/webauthn/register/verify", async (c) => {
    if (credentials.length > 0 && !config.allowRegister) {
      return c.json({ error: { code: "SCOPE_DENIED", message: "Registration is disabled" } }, 403);
    }
    const body = await c.req.json<{ response?: unknown }>();
    const response = body.response;
    const challenge = responseChallenge(response);
    const entry = challenge ? challenges.get(challenge) : undefined;
    if (!challenge || !entry || entry.purpose !== "register" || entry.expiresAt <= now()) {
      if (challenge) challenges.delete(challenge);
      return c.json({ error: { code: "AUTH_REQUIRED", message: "Unknown or expired challenge" } }, 400);
    }
    challenges.delete(challenge);
    let verification;
    try {
      verification = await verifyRegistration({
        response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
        expectedChallenge: challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
      });
    } catch {
      return c.json({ error: { code: "AUTH_REQUIRED", message: "Passkey verification failed" } }, 400);
    }
    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: { code: "AUTH_REQUIRED", message: "Passkey verification failed" } }, 400);
    }
    const registered = verification.registrationInfo.credential;
    const credential: StoredCredential = {
      id: registered.id,
      publicKey: Buffer.from(registered.publicKey).toString("base64url"),
      counter: registered.counter,
      transports: (registered.transports ?? []) as string[],
    };
    const existingIndex = credentials.findIndex((item) => item.id === credential.id);
    if (existingIndex < 0) credentials.push(credential);
    else credentials[existingIndex] = credential;
    saveCredentials(credentialsPath, credentials);
    return c.json({ verified: true });
  });

  app.post("/webauthn/authenticate/options", async (c) => {
    if (credentials.length === 0) {
      return c.json({ error: { code: "AUTH_REQUIRED", message: "No passkey is registered" } }, 403);
    }
    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials: credentials.map((credential) => ({
        id: credential.id,
        transports: credential.transports as never[],
      })),
      userVerification: "required",
    });
    challenges.set(options.challenge, {
      purpose: "authenticate",
      expiresAt: now() + CHALLENGE_TTL_MS,
    });
    return c.json(options);
  });

  app.post("/webauthn/authenticate/verify", async (c) => {
    const body = await c.req.json<{ response?: { id?: string } }>();
    const response = body.response;
    const credential = credentials.find((item) => item.id === response?.id);
    if (!credential) {
      return c.json({ error: { code: "AUTH_REQUIRED", message: "Unknown passkey" } }, 400);
    }
    const challenge = responseChallenge(response);
    const entry = challenge ? challenges.get(challenge) : undefined;
    if (!challenge || !entry || entry.purpose !== "authenticate" || entry.expiresAt <= now()) {
      if (challenge) challenges.delete(challenge);
      return c.json({ error: { code: "AUTH_REQUIRED", message: "Unknown or expired challenge" } }, 400);
    }
    challenges.delete(challenge);
    let verification;
    try {
      verification = await verifyAuthentication({
        response: response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
        expectedChallenge: challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        credential: {
          id: credential.id,
          publicKey: Buffer.from(credential.publicKey, "base64url"),
          counter: credential.counter,
          transports: credential.transports as never[],
        },
        requireUserVerification: true,
      });
    } catch {
      return c.json({ error: { code: "AUTH_REQUIRED", message: "Passkey verification failed" } }, 400);
    }
    if (!verification.verified) {
      return c.json({ error: { code: "AUTH_REQUIRED", message: "Passkey verification failed" } }, 400);
    }
    credential.counter = verification.authenticationInfo.newCounter;
    saveCredentials(credentialsPath, credentials);

    if (!config.agentCookieUrl) {
      return c.json(jar!.unlock(config.ttlMs));
    }
    try {
      const token = createUnlockToken(config.unlockSecret!, { now });
      const responseFromWorkspace = await fetchImpl(
        new URL("/personal/unlock", config.agentCookieUrl),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.agentCookieKey ?? ""}`,
          },
          body: JSON.stringify({ token }),
        },
      );
      if (!responseFromWorkspace.ok) {
        return c.json({ error: { code: "UPSTREAM_ERROR", message: "Workspace unlock failed" } }, 502);
      }
      return c.json(await responseFromWorkspace.json());
    } catch {
      return c.json({ error: { code: "UPSTREAM_ERROR", message: "Workspace unlock failed" } }, 502);
    }
  });

  if (!config.agentCookieUrl) {
    if (config.dev) {
      app.post("/dev/sign", async (c) => {
        try {
          const body = await c.req.json<{ handshake: Handshake }>();
          const signature = await jar!.signHandshake(body.handshake);
          return c.json({ ...body.handshake, ...signature });
        } catch (error) {
          if (error instanceof LaneError) return c.json(error.toBody(), error.status as 403);
          return c.json({ error: { code: "AUTH_REQUIRED", message: "Invalid handshake" } }, 400);
        }
      });
    }
    app.get("/.well-known/agent-cookie-jwks.json", (c) => {
      const sessionId = c.req.query("sessionId");
      if (!sessionId) {
        return c.json({ error: { code: "AUTH_REQUIRED", message: "sessionId is required" } }, 400);
      }
      try {
        return c.json(jar!.jwks(sessionId));
      } catch (error) {
        if (error instanceof LaneError) return c.json(error.toBody(), error.status as 403);
        return c.json({ error: { code: "AUTH_REQUIRED", message: "Unable to read JWKS" } }, 400);
      }
    });
  }

  app.onError((error, c) => {
    if (error instanceof LaneError) return c.json(error.toBody(), error.status as 403);
    if (
      error instanceof SyntaxError
      || (error instanceof HTTPException && error.status === 400)
    ) {
      return c.json({
        error: { code: "AUTH_REQUIRED", message: "Invalid request body" },
      }, 400);
    }
    return c.json({ error: { code: "UPSTREAM_ERROR", message: "Request failed" } }, 502);
  });
  return app;
}
