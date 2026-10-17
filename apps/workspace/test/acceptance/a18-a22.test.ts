// A18, A22 (+ the manual A10, A17) — plan v0.3 §2 验收清单. Black box: HTTP only, against the real wiring (lane C
// seed, git memory repo, lane D's adapter replaying fixtures/ucp recordings).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AGENTS, api, deriveSessionId, getQuotes, grants, introduce, KEYS, loadScenario, merchant, PINNED, pinnedIntent, receipts, reset, SEED,
  SHOE_AUTO_FIELDS, startCallbackServer, startWorkspace, ucpAgent, type Api, type CallbackServer, type Json,
  type Workspace,
} from "./helpers.js";

let ws: Workspace;
let cb1: CallbackServer;

beforeAll(async () => {
  [ws, cb1] = await Promise.all([startWorkspace(), startCallbackServer()]);
}, 60_000);

afterAll(async () => {
  await Promise.all([ws?.stop(), cb1?.close()]);
});

const T = { timeout: 45_000 };
const LOCAL_LEAKS = ["/home/", "/tmp/", "ENOENT", "fixtures", "/private/", "node_modules"];

function expectNotSuccess(body: Json): void {
  expect(body.status).not.toBe("ordered");
  expect(body.orderId).toBeUndefined();
}

describe("A18 UCP 失败路径（录制：complete → requires_escalation / INSUFFICIENT_PERMISSIONS）", T, () => {
  let personal: Api;

  beforeEach(async () => {
    await reset(ws.url);
    personal = api(ws.url, KEYS.personal);
  });

  for (const offer of PINNED.offers) {
    it(`accepting ${offer.seller}: cart → checkout → address read → destination → complete hands off honestly`, async () => {
      const other = PINNED.offers.find((o) => o.seller !== offer.seller)!;
      const { quotes } = await pinnedIntent(personal);
      const quote = quotes.quotes.find((x: Json) => x.seller === offer.seller);
      expect(quote, `no quote from ${offer.seller}`).toBeDefined();
      expect(quote.variantId).toBe(offer.variantId);

      const a = await personal.post(`/personal/quotes/${quote.id}/accept`);
      expect(a.status).toBe(200);
      expect(a.body.quoteId).toBe(quote.id);
      // The recorded complete is INSUFFICIENT_PERMISSIONS (the store wants the buyer signed in). UCP's guidance for
      // AUTH_REQUIRED is to hand off to the continue URL, so this is a handoff (user pays on the store page, A17 in
      // docs/requests.md) — never "ordered", never an order id.
      expect(a.body.status).toBe("handoff");
      expect(a.body.code).toBeUndefined();
      expectNotSuccess(a.body);
      expect(typeof a.body.continueUrl).toBe("string");
      expect(a.body.continueUrl).toMatch(/^https:\/\//);
      expect(typeof a.body.message).toBe("string");
      expect(a.body.message.trim().length).toBeGreaterThan(0);
      for (const leak of LOCAL_LEAKS) expect(a.text, `accept body leaks ${leak}`).not.toContain(leak);
      for (const n of SEED.addressNeedles) expect(a.text).not.toContain(n);

      // the address was read for checkout by the chosen seller only, with a receipt
      const rs = await receipts(personal);
      const addressReads = rs.filter((x) => (x.fields as string[]).includes("shipping_address"));
      expect(addressReads.map((x) => x.agentId)).toEqual([ucpAgent(offer.seller)]);
      expect(addressReads[0]).toMatchObject({ fields: ["shipping_address"], purpose: "checkout" });
      expect(rs.some((x) => x.agentId === ucpAgent(other.seller) && (x.fields as string[]).includes("shipping_address"))).toBe(false);

      // asking again returns the identical stored result and does not read the address again
      const again = await personal.post(`/personal/quotes/${quote.id}/accept`);
      expect(again.status).toBe(200);
      expect(again.text).toBe(a.text);
      expect((await receipts(personal)).filter((x) => (x.fields as string[]).includes("shipping_address"))).toHaveLength(1);
    });
  }

});

// The two remaining A18 cases run only on lane D's real failure recordings (fixtures/ucp/scenarios/<name>/, see
// loadScenario). Until a recording exists the case is a todo; it is never simulated.
const SCENARIOS = [
  { name: "sold-out", todo: "sold-out warning: no recorded sold-out response yet (fixtures/ucp/scenarios/sold-out/)" },
  { name: "requires-escalation", todo: "requires_escalation → handoff with continue_url: no recorded response yet (fixtures/ucp/scenarios/requires-escalation/)" },
] as const;

for (const sc of SCENARIOS) {
  const scenario = loadScenario(sc.name);
  if (!scenario) {
    describe(`A18 ${sc.name}（录制）`, () => { it.todo(sc.todo); });
    continue;
  }
  describe(`A18 ${sc.name}（录制 ${scenario.dir.split("/fixtures/")[1]}）`, T, () => {
    let sws: Workspace;
    beforeAll(async () => { sws = await startWorkspace({ AGENT_COOKIE_UCP_FIXTURES: scenario.dir }); }, 60_000);
    afterAll(async () => { await sws?.stop(); });

    for (const offer of scenario.pinned.offers) {
      it(`accepting ${offer.seller}: the recorded ${sc.name} reaches the user as it is, with a continue URL, never as success`, async () => {
        const personal = api(sws.url, KEYS.personal);
        const r = await personal.post("/personal/intents", scenario.intent);
        expect(r.status).toBe(201);
        const quotes = await getQuotes(personal, r.body.intentId, 10_000);
        const quote = quotes.quotes.find((x: Json) => x.seller === offer.seller && x.variantId === offer.variantId);
        expect(quote, `no quote for the recorded variant at ${offer.seller}`).toBeDefined();

        const a = await personal.post(`/personal/quotes/${quote.id}/accept`);
        expect(a.status).toBe(200);
        expectNotSuccess(a.body);
        expect(a.body.continueUrl).toMatch(/^https:\/\//);
        expect(typeof a.body.message).toBe("string");
        for (const leak of LOCAL_LEAKS) expect(a.text, `accept body leaks ${leak}`).not.toContain(leak);
        for (const n of SEED.addressNeedles) expect(a.text).not.toContain(n);
        if (sc.name === "requires-escalation") {
          expect(a.body.status).toBe("handoff");
        } else {
          expect(["failed", "handoff"]).toContain(a.body.status);
          // the recorded warning/error text is passed through verbatim
          const told = scenario.messages.filter((m) => m.type === "warning" || m.type === "error");
          expect(told.length, "sold-out recording has no warning/error message").toBeGreaterThan(0);
          for (const m of told) expect(a.body.message).toContain(m.content);
        }
      });
    }
  });
}

describe("A22 回头客", T, () => {
  let photon: Api;
  let desktop: Api;
  const seller = PINNED.offers[0]!.seller;

  beforeEach(async () => {
    cb1.clear();
    await reset(ws.url);
    photon = api(ws.url, KEYS.personal);
    desktop = api(ws.url, KEYS.desktop);
  });

  async function sellerSessions(): Promise<string[]> {
    return (await grants(photon)).filter((g) => g.agentId === ucpAgent(seller)).map((g) => g.sessionId as string);
  }

  it(`the ${seller} session ID is identical from both personal agents' pinned intents`, async () => {
    await pinnedIntent(photon);
    const [viaPhoton] = await sellerSessions();
    expect(typeof viaPhoton).toBe("string");
    await pinnedIntent(desktop);
    const all = await sellerSessions();
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

  it(`the ${seller} session ID survives POST /demo/reset and equals the contract derivation`, async () => {
    await pinnedIntent(photon);
    const [before] = await sellerSessions();
    await reset(ws.url);
    await pinnedIntent(desktop);
    const [after] = await sellerSessions();
    expect(after).toBe(before);
    expect(after).toBe(deriveSessionId(SEED.userSecret, seller));
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
      for (const id of [SEED.userName, SEED.userId, SEED.userSecret, AGENTS.photon, AGENTS.desktop]) {
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
