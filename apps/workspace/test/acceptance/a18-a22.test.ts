// A18, A22 (+ the manual A10, A17) — plan v0.3 §2 验收清单. Black box: HTTP only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_ID_VECTORS } from "@agent-cookie/contract";
import {
  api, getQuotes, grants, introduce, KEYS, merchant, reset, SEED, SHOE_AUTO_FIELDS, startCallbackServer,
  startWorkspace, type Api, type CallbackServer, type Json, type Workspace,
} from "./helpers.js";

let ws: Workspace; // UCP_STUB_COMPLETE unset → requires_escalation
let soldOut: Workspace; // UCP_STUB_COMPLETE=sold_out
let upstreamError: Workspace; // UCP_STUB_COMPLETE=error
let cb1: CallbackServer;

beforeAll(async () => {
  [ws, soldOut, upstreamError, cb1] = await Promise.all([
    startWorkspace(),
    startWorkspace({ UCP_STUB_COMPLETE: "sold_out" }),
    startWorkspace({ UCP_STUB_COMPLETE: "error" }),
    startCallbackServer(),
  ]);
}, 90_000);

afterAll(async () => {
  await Promise.all([ws?.stop(), soldOut?.stop(), upstreamError?.stop(), cb1?.close()]);
});

const T = { timeout: 30_000 };

/** trail_shoes intent on `w`, then accept the quote of `seller`. */
async function acceptSeller(w: Workspace, seller: string): Promise<{ status: number; body: Json; quote: Json }> {
  const personal = api(w.url, KEYS.personal);
  const r = await personal.post("/personal/intents", { kind: "trail_shoes", public: { budget: "120" } });
  expect(r.status).toBe(201);
  const q = await getQuotes(personal, r.body.intentId, 10_000);
  const quote = q.quotes.find((x: Json) => x.seller === seller);
  expect(quote, `no quote from ${seller}`).toBeDefined();
  const a = await personal.post(`/personal/quotes/${quote.id}/accept`);
  return { status: a.status, body: a.body, quote };
}

function expectNotSuccess(body: Json): void {
  expect(body.status).not.toBe("ordered");
  expect(body.orderId).toBeUndefined();
}

describe("A18 UCP 失败路径", T, () => {
  beforeEach(async () => {
    await Promise.all([reset(ws.url), reset(soldOut.url), reset(upstreamError.url)]);
  });

  it("default (requires_escalation): status handoff with a continueUrl, never ordered", async () => {
    for (const seller of ["shoebacca.com", "marathonsports.com"]) {
      const { status, body, quote } = await acceptSeller(ws, seller);
      expect(status).toBe(200);
      expect(body.status).toBe("handoff");
      expect(body.quoteId).toBe(quote.id);
      expect(typeof body.continueUrl).toBe("string");
      expect(body.continueUrl).toMatch(/^https?:\/\//);
      expectNotSuccess(body);
    }
  });

  it("sold out: status failed with the upstream message, never ordered", async () => {
    const { status, body, quote } = await acceptSeller(soldOut, "shoebacca.com");
    expect(status).toBe(200);
    expect(body.status).toBe("failed");
    expect(body.quoteId).toBe(quote.id);
    expect(body.code).toBe("UPSTREAM_ERROR");
    expect(typeof body.message).toBe("string");
    expect(body.message.trim().length).toBeGreaterThan(0);
    if (body.continueUrl !== undefined) expect(body.continueUrl).toMatch(/^https?:\/\//);
    expectNotSuccess(body);
    // asking again does not turn it into a success
    const again = await api(soldOut.url, KEYS.personal).post(`/personal/quotes/${quote.id}/accept`);
    expect(again.body.status).toBe("failed");
    expectNotSuccess(again.body);
  });

  it("upstream error: status failed, code UPSTREAM_ERROR, never ordered", async () => {
    const { status, body } = await acceptSeller(upstreamError, "shoebacca.com");
    expect(status).toBe(200);
    expect(body.status).toBe("failed");
    expect(body.code).toBe("UPSTREAM_ERROR");
    expectNotSuccess(body);
  });
});

describe("A22 回头客", T, () => {
  let photon: Api;
  let desktop: Api;

  beforeEach(async () => {
    cb1.clear();
    await reset(ws.url);
    photon = api(ws.url, KEYS.personal);
    desktop = api(ws.url, KEYS.desktop);
  });

  async function shoebaccaSessions(): Promise<string[]> {
    return (await grants(photon)).filter((g) => g.agentId === SEED.shoebacca).map((g) => g.sessionId as string);
  }

  it("the Shoebacca session ID is identical from ck_personal_sample and ck_personal_desktop_sample intents", async () => {
    expect((await photon.post("/personal/intents", { kind: "trail_shoes" })).status).toBe(201);
    const [viaPhoton] = await shoebaccaSessions();
    expect(typeof viaPhoton).toBe("string");
    expect((await desktop.post("/personal/intents", { kind: "trail_shoes" })).status).toBe(201);
    const all = await shoebaccaSessions();
    expect(all).toHaveLength(2);
    expect(new Set(all)).toEqual(new Set([viaPhoton]));
  });

  it("a callback merchant sees the same session ID whichever personal agent introduced the user", async () => {
    const m1 = await merchant(ws.url, cb1);
    const { sessions: [a] } = await introduce(photon, [m1]);
    const { sessions: [b] } = await introduce(desktop, [m1]);
    expect(a).toBeDefined();
    expect(b).toBe(a);
  });

  it("the Shoebacca session ID survives POST /demo/reset", async () => {
    expect((await photon.post("/personal/intents", { kind: "trail_shoes" })).status).toBe(201);
    const [before] = await shoebaccaSessions();
    await reset(ws.url);
    expect((await desktop.post("/personal/intents", { kind: "trail_shoes" })).status).toBe(201);
    const [after] = await shoebaccaSessions();
    expect(after).toBe(before);
    const vector = SESSION_ID_VECTORS.find((v) => v.userSecret === SEED.userSecret && v.merchantKey === "shoebacca.com");
    expect(after).toBe(vector?.sessionId);
  });

  it("no handshake or fields body carries an email, a phone number, the user's name or a global ID", async () => {
    const m1 = await merchant(ws.url, cb1);
    const bodies: Array<{ text: string; sessionId: string; jar?: string }> = [];
    for (const who of [photon, desktop]) {
      const { intros: [intro], sessions: [s] } = await introduce(who, [m1]);
      bodies.push({ text: JSON.stringify(intro.handshake), sessionId: s!, jar: intro.handshake.jar });
      const h = await m1.api.get(`/agent/handshake?sessionId=${s}`);
      expect(h.status).toBe(200);
      bodies.push({ text: h.text, sessionId: s!, jar: h.body.jar });
      const f = await m1.api.get(`/agent/fields?sessionId=${s}&fields=${SHOE_AUTO_FIELDS.join(",")}`);
      expect(f.status).toBe(200);
      bodies.push({ text: f.text, sessionId: s! });
      cb1.clear();
    }
    for (const b of bodies) {
      expect(b.text).not.toContain("@");
      for (const id of [SEED.userName, SEED.userId, SEED.userSecret, "personal-photon", "personal-desktop"]) {
        expect(b.text).not.toContain(id);
      }
      // drop the parts that are legitimately numeric (session ID, jar URL with its port, ISO timestamps)
      let scan = b.text.split(b.sessionId).join("");
      if (b.jar) scan = scan.split(b.jar).join("");
      scan = scan.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "");
      expect(scan).not.toMatch(/\+\d[\d\s().-]{6,}\d/);
      expect(scan).not.toMatch(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/);
      expect(scan).not.toMatch(/\d{7,}/);
    }
  });
});

describe("A10 真实客户端（手动）", () => {
  it.todo("Claude Desktop 经 MCP 完成一次 find_agents，/owner/activity 里有记录；导出证据到 docs/evidence/（手动，不在本套件内跑）");
});

describe("A17 iMessage 主流程（手动）", () => {
  it.todo("iMessage 一句话 → 付款链接（或已下单），不离开对话，用户没输入尺码和地址；录屏存 docs/evidence/（手动）");
});
