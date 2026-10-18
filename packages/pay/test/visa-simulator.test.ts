import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startSimulator, SAMPLE_CREDENTIALS, type Outcome } from "@agent-cookie/visa-sim";
import { visaProvider, type VisaDebugEntry } from "../src/visa.js";
import { createPayments } from "../src/payments.js";

type Sim = Awaited<ReturnType<typeof startSimulator>>;
const servers: Sim[] = [];
const INSTRUMENT = "SampleIntegrationInstrument";
const input = { amount: 1250, currency: "USD" as const, paymentMethodRef: `tms_${INSTRUMENT}`, idempotencyKey: "SampleQuote" };
beforeEach(() => vi.stubEnv("VISA_ACCEPTANCE_SIMULATOR", "1"));
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(servers.splice(0).map((sim) => sim.close())); });
async function setup(outcome: Outcome) {
  const sim = await startSimulator({ scenario: { instruments: { [INSTRUMENT]: [outcome] } } });
  servers.push(sim);
  const provider = visaProvider({ ...SAMPLE_CREDENTIALS, host: sim.url, timeoutMs: 300 });
  const authorize = () => provider.authorize(input);
  return { sim, provider, authorize };
}

describe("Visa Acceptance simulator: provider bytes over real loopback HTTP, not a Visa sandbox call", () => {
  it("the provider smoke command runs in the existing root test/CI job", async () => {
    const { stdout } = await promisify(execFile)("pnpm", ["--filter", "@agent-cookie/pay", "smoke:visa-simulator"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), timeout: 10_000,
    });
    expect(stdout).toContain(JSON.stringify({ provider: "Visa Acceptance simulator", simulated: true, authorization: "authorized", reversal: "reversed", result: "passed" }));
    expect(stdout).not.toContain(INSTRUMENT);
    expect(stdout).not.toContain(SAMPLE_CREDENTIALS.sharedSecret);
  }, 15_000);
  it("authorize → capture is SDK-verified over HTTP and explicitly labelled simulated", async () => {
    const { sim, provider, authorize } = await setup("authorize");
    expect(provider).toMatchObject({ label: "Visa Acceptance simulator", simulated: true });
    const auth = await authorize();
    expect(auth).toMatchObject({ status: "authorized", label: "Visa Acceptance simulator", simulated: true });
    await provider.capture(auth.providerRef, auth.authorizedAmount, "USD");
    await expect(provider.capture(auth.providerRef, auth.authorizedAmount, "USD")).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(sim.snapshot().events.map((e) => e.operation)).toEqual(["authorize", "capture"]);
  });

  it("authorize → reverse releases the response's authorized amount", async () => {
    const { sim, provider, authorize } = await setup("authorize");
    const auth = await authorize();
    await provider.reverse!(auth.providerRef, auth.authorizedAmount!, "USD");
    expect(sim.snapshot().holds).toEqual([{ id: "sim00000001", amount: 1250, status: "reversed" }]);
  });

  it.each(["decline", "invalid"] as const)("%s is explicitly simulated and creates no hold", async (outcome) => {
    const { sim, authorize } = await setup(outcome);
    expect(await authorize()).toMatchObject({ status: "declined", label: "Visa Acceptance simulator", simulated: true });
    expect(sim.snapshot().holds).toEqual([]);
  });

  it.each(["partial", "review"] as const)("%s reverses the hold for its authorized amount, then fails", async (outcome) => {
    const { sim, authorize } = await setup(outcome);
    await expect(authorize()).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(sim.snapshot().holds).toEqual([{ id: "sim00000001", amount: outcome === "partial" ? 625 : 1250, status: "reversed" }]);
  });

  it("timeout BEFORE authorization leaves no simulated hold", async () => {
    const { sim, authorize } = await setup("timeout");
    await expect(authorize()).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(sim.snapshot().holds).toEqual([]);
    // A timeout AFTER a real provider made a hold is unknowable without reconciliation; this does not prove otherwise.
  });

  it("public payment hooks accept simulated providers (the contract carries the provenance)", async () => {
    const { sim, provider } = await setup("authorize");
    expect(() => createPayments({ provider, getContext: async () => null })).not.toThrow();
    expect(sim.snapshot().holds).toEqual([]);
  });

  it.each(["http://localhost:4313", "https://127.0.0.1:4313", "http://0.0.0.0:4313", "http://127.0.0.1:0", "http://127.0.0.1:65536",
    "http://127.0.0.1:4313/", "http://127.0.0.1:4313@evil.example", "http://127.0.0.1:4313?x", "http://127.0.0.2:4313", "api.cybersource.com"])("refuses non-exact simulator target %s", (host) => {
    expect(() => visaProvider({ ...SAMPLE_CREDENTIALS, host })).toThrow(/only the sandbox host/);
  });

  it("loopback requires the explicit simulator flag and the sandbox remains HTTPS", () => {
    vi.stubEnv("VISA_ACCEPTANCE_SIMULATOR", "0");
    expect(() => visaProvider({ ...SAMPLE_CREDENTIALS, host: "http://127.0.0.1:4313" })).toThrow(/only the sandbox host/);
    expect(visaProvider(SAMPLE_CREDENTIALS).label).toBeUndefined();
  });

  it("does not follow redirects from the simulator to another origin", async () => {
    const seen: RequestInit[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => { seen.push(init!); return new Response("", { status: 302, headers: { Location: "https://evil.example" } }); });
    const provider = visaProvider({ ...SAMPLE_CREDENTIALS, host: "http://127.0.0.1:4313", fetch: fetch as typeof globalThis.fetch });
    await expect(provider.authorize(input)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(seen[0]?.redirect).toBe("error");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("debug and thrown outcomes retain simulation provenance without request or authorization field values", async () => {
    const { sim } = await setup("review");
    const entries: VisaDebugEntry[] = [];
    const provider = visaProvider({ ...SAMPLE_CREDENTIALS, host: sim.url, debug: (entry) => { entries.push(entry); } });
    await expect(provider.authorize(input)).rejects.toThrow("Visa Acceptance simulator authorization failed");
    expect(entries).toHaveLength(4);
    for (const entry of entries) expect(entry).toMatchObject({ label: "Visa Acceptance simulator", simulated: true });
    const log = JSON.stringify(entries);
    for (const value of [SAMPLE_CREDENTIALS.merchantId, SAMPLE_CREDENTIALS.keyId, SAMPLE_CREDENTIALS.sharedSecret, INSTRUMENT, "sim00000001", "SampleQuote"]) {
      expect(log).not.toContain(value);
    }
    expect(entries[2]?.path).toBe("/pts/v2/payments/[redacted]/reversals");
  });
});
