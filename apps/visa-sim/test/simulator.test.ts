import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { startSimulator, SAMPLE_CREDENTIALS, sdkHeaders, parseScenario, type Outcome } from "../src/index.js";

const INSTRUMENT = "SampleAuthorizeInstrument";
const DATE = new Date("2026-10-18T12:00:00Z");
type Sim = Awaited<ReturnType<typeof startSimulator>>;
const servers: Sim[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((sim) => sim.close())); });
async function start(steps: Outcome[] = ["authorize"]) {
  const sim = await startSimulator({ now: () => DATE, scenario: { instruments: { [INSTRUMENT]: steps } } });
  servers.push(sim);
  return sim;
}
const payload = () => JSON.stringify({ processingInformation: { capture: false }, paymentInformation: { paymentInstrument: { id: INSTRUMENT } },
  orderInformation: { amountDetails: { totalAmount: "12.50", currency: "USD" } } });
function signed(sim: Sim, path = "/pts/v2/payments", body = payload(), date = DATE.toUTCString()) {
  return { ...sdkHeaders({ ...SAMPLE_CREDENTIALS, host: new URL(sim.url).host, path, body, date }),
    "v-c-merchant-id": SAMPLE_CREDENTIALS.merchantId, Date: date, "Content-Type": "application/json" };
}
const post = (sim: Sim, path: string, body: string, headers: Record<string, string> = signed(sim, path, body)) => fetch(`${sim.url}${path}`, { method: "POST", headers, body });

describe("Visa Acceptance simulator: SDK oracle, HTTP only, no Visa server involved", () => {
  it("the installed SDK reproduces all existing POST goldens unchanged", () => {
    const golden = JSON.parse(readFileSync(new URL("../../../packages/pay/test/fixtures/visa-acceptance/sdk-signature-golden.json", import.meta.url), "utf8"));
    for (const c of golden.cases.filter((c: { method: string }) => c.method === "POST")) {
      expect(sdkHeaders({ ...golden.credentials, path: c.path, body: c.body, date: golden.date })).toEqual(c.sdkOutput);
    }
  });

  it.each([
    ["authorize", 201, "AUTHORIZED"], ["decline", 201, "DECLINED"], ["partial", 201, "PARTIAL_AUTHORIZED"],
    ["review", 201, "AUTHORIZED_PENDING_REVIEW"], ["invalid", 400, "INVALID_REQUEST"],
  ] as const)("script %s emits the SDK model, explicitly simulated", async (outcome, code, status) => {
    const sim = await start([outcome]);
    const response = await post(sim, "/pts/v2/payments", payload());
    expect(response.status).toBe(code);
    expect(response.headers.get("x-agent-cookie-simulation")).toBe("Visa Acceptance simulator");
    const body = await response.json();
    expect(body.status).toBe(status);
    if (outcome === "decline") expect(body.errorInformation.reason).toBe("PROCESSOR_DECLINED");
    if (outcome === "partial") expect(body.orderInformation.amountDetails.authorizedAmount).toBe("6.25");
    expect(sim.snapshot().holds).toHaveLength(["decline", "invalid"].includes(outcome) ? 0 : 1);
  });

  it("timeout stalls before authorization and makes no hold", async () => {
    const sim = await start(["timeout"]);
    await expect(fetch(`${sim.url}/pts/v2/payments`, { method: "POST", headers: signed(sim), body: payload(), signal: AbortSignal.timeout(150) })).rejects.toThrow();
    expect(sim.snapshot()).toMatchObject({ holds: [], events: [{ operation: "authorize", outcome: "timeout" }] });
  });

  it.each(["digest", "signature", "merchant", "past-date", "future-date", "parentheses", "content-type", "origin"])("refuses %s without advancing the script", async (kind) => {
    const sim = await start();
    const headers: Record<string, string> = signed(sim);
    if (kind === "digest") headers.Digest = "SHA-256=tampered";
    if (kind === "signature") headers.Signature += "tampered";
    if (kind === "merchant") headers["v-c-merchant-id"] = "other";
    if (kind.endsWith("date")) headers.Date = new Date(DATE.getTime() + (kind === "past-date" ? -301_000 : 301_000)).toUTCString();
    if (kind === "parentheses") headers.Signature = headers.Signature!.replace("request-target", "(request-target)");
    if (kind === "content-type") headers["Content-Type"] = "text/plain";
    if (kind === "origin") headers.Origin = "https://untrusted.example";
    expect((await post(sim, "/pts/v2/payments", payload(), headers)).status).toBe(kind === "content-type" || kind === "origin" ? 400 : 401);
    expect(sim.snapshot().events).toEqual([]);
    expect((await post(sim, "/pts/v2/payments", payload())).status).toBe(201);
  });

  it("refuses a tampered body byte and a different request path", async () => {
    const sim = await start();
    const headers = signed(sim);
    expect((await post(sim, "/pts/v2/payments", payload().replace("12.50", "12.51"), headers)).status).toBe(401);
    expect((await post(sim, "/pts/v2/payments/sim00000001/captures", payload(), headers)).status).toBe(401);
    expect(sim.snapshot().holds).toEqual([]);
  });

  it("refuses an incorrect Host authority", async () => {
    const sim = await start();
    const code = await new Promise((resolve, reject) => {
      const req = request(`${sim.url}/pts/v2/payments`, { method: "POST", headers: { ...signed(sim), Host: "other.example" } }, (res) => {
        res.resume(); resolve(res.statusCode);
      });
      req.on("error", reject); req.end(payload());
    });
    expect(code).toBe(400);
    expect(sim.snapshot().events).toEqual([]);
  });

  it.each([-300_000, 300_000])("accepts the inclusive Date skew boundary %s", async (skew) => {
    const sim = await start();
    const date = new Date(DATE.getTime() + skew).toUTCString();
    expect((await post(sim, "/pts/v2/payments", payload(), signed(sim, "/pts/v2/payments", payload(), date))).status).toBe(201);
  });

  it("reset replays the same script and deterministic ids; exhaustion is not random", async () => {
    const sim = await start(["authorize", "decline"]);
    const first = await (await post(sim, "/pts/v2/payments", payload())).json();
    expect((await (await post(sim, "/pts/v2/payments", payload())).json()).status).toBe("DECLINED");
    expect((await post(sim, "/pts/v2/payments", payload())).status).toBe(409);
    const reset = await post(sim, "/__sim/reset", "{}");
    expect(await reset.json()).toEqual({ provider: "Visa Acceptance simulator", simulated: true, reset: true });
    expect(sim.snapshot().holds).toEqual([]);
    expect(await (await post(sim, "/pts/v2/payments", payload())).json()).toEqual(first);
  });

  it.each(["captures", "reversals"] as const)("%s requires the held amount and cannot consume the hold twice", async (operation) => {
    const sim = await start();
    const auth = await (await post(sim, "/pts/v2/payments", payload())).json();
    const path = `/pts/v2/payments/${auth.id}/${operation}`;
    const field = operation === "captures" ? "orderInformation" : "reversalInformation";
    const body = JSON.stringify({ [field]: { amountDetails: { totalAmount: "12.50", currency: "USD" } } });
    expect((await post(sim, path, body.replace("12.50", "12.49"))).status).toBe(400);
    expect((await (await post(sim, path, body)).json()).status).toBe(operation === "captures" ? "PENDING" : "REVERSED");
    expect((await post(sim, path, body)).status).toBe(400);
  });

  it("rejects malformed scripts without echoing instrument values", () => {
    for (const instruments of [null, [], { "4111111111111111": ["authorize"] }, { [INSTRUMENT]: ["invented"] }, { [INSTRUMENT]: [] }]) {
      expect(() => parseScenario({ instruments })).toThrow(/Visa Acceptance simulator: invalid/);
    }
  });
});
