// A29 (Phase 5, "bring your own agent", owner key minting; contract endpoints.ts /owner/keys). Black box: HTTP only,
// against a BLANK instance (AGENT_COOKIE_SEED=blank: no Sample data, no Sample key; one minted owner key in
// <dataDir>/owner.key, read here and never printed). The owner mints a key for their own personal agent; that agent,
// using ONLY @agent-cookie/sdk (the built dist), reads the card back with the two preferences it wrote; the owner's list
// shows the key without the key; after revocation the agent's next SDK call rejects 401 AUTH_REQUIRED, and what it
// wrote stays on the owner's card.
// The owner's side (mint, list, revoke) is plain HTTP with the owner key; everything the agent does is the SDK.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceClient } from "../../../../packages/sdk/dist/index.js";
import { api, startWorkspace, type Json, type Workspace } from "./helpers.js";

let ws: Workspace;
let dataDir: string;
let ownerKey: string;

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "agent-cookie-a29-"));
  ws = await startWorkspace({ AGENT_COOKIE_SEED: "blank", AGENT_COOKIE_DATA_DIR: dataDir, SQLITE_PATH: path.join(dataDir, "workspace.sqlite") });
  ownerKey = readFileSync(path.join(dataDir, "owner.key"), "utf8").trim();
}, 60_000);

afterAll(async () => {
  await ws?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const valueOf = (card: Json, field: string): string | undefined => (card.card as Array<{ field: string; value: string }>).find((f) => f.field === field)?.value;

describe("A29 · the owner mints a key for their own agent, the agent knows them through the SDK, revocation stops it", () => {
  it("mint → write two preferences → SDK reads them on the card → listed without the key → revoke → SDK 401, values stay", async () => {
    const owner = api(ws.url, ownerKey);

    // A blank card to start with.
    const before = await owner.get("/personal/card");
    expect(before.status).toBe(200);
    expect(before.body.card).toEqual([]);

    // Mint: the key is in this response only.
    const minted = await owner.post("/owner/keys", { agentId: "my-laptop-agent", role: "personal", label: "laptop" });
    expect(minted.status).toBe(201);
    expect(minted.body).toMatchObject({ agentId: "my-laptop-agent", role: "personal", label: "laptop" });
    const key: string = minted.body.key;
    expect(key).toMatch(/^ck_/);

    const agent = new WorkspaceClient({ baseUrl: ws.url, key });
    expect(await agent.getMe()).toEqual({ agentId: "my-laptop-agent", category: "personal", role: "personal" });

    // The agent writes two things the person said, with the SDK (stored as stated: the person's own agent)…
    expect(await agent.remember({ field: "pref.brand", value: "Hoka" })).toMatchObject({ field: "pref.brand", basis: "stated" });
    expect(await agent.remember({ field: "shoe_size", value: "42" })).toMatchObject({ field: "shoe_size", basis: "stated" });

    // …and reads them back through the SDK.
    const card = await agent.getMyCard() as Json;
    expect(valueOf(card, "pref.brand")).toBe("Hoka");
    expect(valueOf(card, "shoe_size")).toBe("42");

    // The owner's list shows the key's metadata, never the key or a hash.
    const list = await owner.get("/owner/keys");
    expect(list.status).toBe(200);
    expect(list.body.keys).toEqual([{ agentId: "my-laptop-agent", role: "personal", label: "laptop", createdAt: minted.body.createdAt }]);
    expect(list.text.includes(key)).toBe(false);
    expect(list.text).not.toMatch(/[0-9a-f]{64}/);

    // Revoke: every live key of that agent.
    const revoked = await owner.post("/owner/keys/my-laptop-agent/revoke");
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ ok: true, revoked: 1 });

    // The agent's next SDK call rejects 401 AUTH_REQUIRED.
    const err = await agent.getMyCard().then(() => undefined, (e: unknown) => e as { status?: number; code?: string });
    expect(err).toBeDefined();
    expect(err!.status).toBe(401);
    expect(err!.code).toBe("AUTH_REQUIRED");
    expect((await owner.get("/owner/keys")).body.keys[0].revokedAt).toBe(revoked.body.revokedAt);

    // What it wrote stays on the owner's card.
    const after = await owner.get("/personal/card");
    expect(valueOf(after.body, "pref.brand")).toBe("Hoka");
    expect(valueOf(after.body, "shoe_size")).toBe("42");

    // Never in the workspace's own output either.
    expect(ws.output().includes(key)).toBe(false);
  });
});
