import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { equal, model, SAMPLE_CREDENTIALS, sdkHeaders, type Credentials, type ModelName } from "./sdk.js";
import { parseScenario, type Outcome, type Scenario } from "./scenario.js";

export { SAMPLE_CREDENTIALS, sdkHeaders } from "./sdk.js";
export { parseScenario, type Scenario, type Outcome } from "./scenario.js";
export const SIMULATOR_LABEL = "Visa Acceptance simulator";
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const cents = (value: unknown): number | undefined => {
  if (typeof value !== "string" || !/^\d{1,10}\.\d{2}$/.test(value)) return undefined;
  const n = Math.round(Number(value) * 100);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};
const money = (n: number) => (n / 100).toFixed(2);
interface Hold { amount: number; status: "authorized" | "captured" | "reversed" }
interface SimEvent { operation: "authorize" | "capture" | "reverse"; outcome: string; id?: string }

export interface SimulatorOptions {
  credentials?: Credentials;
  scenario?: Scenario;
  now?: () => Date;
}

export async function startSimulator(options: SimulatorOptions = {}, port = 0) {
  const credentials = options.credentials ?? SAMPLE_CREDENTIALS;
  const scenario = parseScenario(options.scenario ?? JSON.parse(readFileSync(new URL("../scenarios/demo.json", import.meta.url), "utf8")));
  const now = options.now ?? (() => new Date());
  const positions = new Map<string, number>();
  const holds = new Map<string, Hold>();
  const events: SimEvent[] = [];
  let nextId = 1;
  let generation = 0;
  let url: string;

  const send = (res: ServerResponse, status: number, name: ModelName, values: Record<string, unknown>) => {
    res.writeHead(status, { "Content-Type": "application/hal+json", "X-Agent-Cookie-Simulation": SIMULATOR_LABEL, "Cache-Control": "no-store" });
    res.end(JSON.stringify(model(name, values)));
  };
  const fail = (res: ServerResponse, status = 400, reason = "INVALID_DATA") => send(res, status, "PtsV2PaymentsPost400Response", {
    submitTimeUtc: now().toISOString(), status: "INVALID_REQUEST", reason, message: `${SIMULATOR_LABEL}: simulated refusal`,
  });
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // No CORS and no browser form/reset requests, even on loopback.
      if (req.method !== "POST" || req.headers.origin !== undefined || req.headers.host !== new URL(url).host || req.headers["content-type"] !== "application/json") {
        return fail(res);
      }
      if (req.url === "/__sim/reset") {
        generation++;
        positions.clear(); holds.clear(); events.length = 0; nextId = 1;
        res.writeHead(200, { "Content-Type": "application/json", "X-Agent-Cookie-Simulation": SIMULATOR_LABEL });
        res.end(JSON.stringify({ provider: SIMULATOR_LABEL, simulated: true, reset: true }));
        return;
      }
      const match = /^\/pts\/v2\/payments(?:\/([A-Za-z0-9]{1,64})\/(captures|reversals))?$/.exec(req.url ?? "");
      if (!match) return fail(res, 404);
      const currentGeneration = generation;
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += Buffer.byteLength(chunk);
        if (length > 16_384) { fail(res, 413); req.resume(); return; }
        chunks.push(Buffer.from(chunk));
      }
      if (currentGeneration !== generation) return fail(res, 409);
      const bytes = Buffer.concat(chunks);
      const text = bytes.toString("utf8");
      if (!bytes.equals(Buffer.from(text))) return fail(res);
      const date = req.headers.date;
      if (!date || !Number.isFinite(Date.parse(date)) || Math.abs(now().getTime() - Date.parse(date)) > 300_000 ||
          req.headers["v-c-merchant-id"] !== credentials.merchantId) return fail(res, 401);
      const expected = sdkHeaders({ ...credentials, host: new URL(url).host, path: req.url!, body: text, date });
      if (!equal(typeof req.headers.digest === "string" ? req.headers.digest : undefined, expected.Digest) ||
          !equal(typeof req.headers.signature === "string" ? req.headers.signature : undefined, expected.Signature)) return fail(res, 401);
      let body: unknown;
      try { body = JSON.parse(text); } catch { return fail(res); }
      if (!object(body)) return fail(res);
      const id = match[1];
      const operation = match[2];
      if (id && operation) {
        const hold = holds.get(id);
        if (!hold || hold.status !== "authorized") return fail(res, 400, "INVALID_PAYMENT_ID");
        const info = operation === "captures" ? body.orderInformation : body.reversalInformation;
        const details = object(info) && object(info.amountDetails) ? info.amountDetails : undefined;
        if (!details || details.currency !== "USD" || cents(details.totalAmount) !== hold.amount) return fail(res, 400, "INVALID_AMOUNT");
        hold.status = operation === "captures" ? "captured" : "reversed";
        const captured = operation === "captures";
        events.push({ operation: captured ? "capture" : "reverse", outcome: hold.status, id });
        return send(res, 201, captured ? "PtsV2PaymentsCapturesPost201Response" : "PtsV2PaymentsReversalsPost201Response", {
          id: `sim${String(nextId++).padStart(8, "0")}`, status: captured ? "PENDING" : "REVERSED", submitTimeUtc: now().toISOString(),
          ...(captured ? { orderInformation: { amountDetails: { totalAmount: money(hold.amount), currency: "USD" } } } : {
            reversalAmountDetails: { reversedAmount: money(hold.amount), originalTransactionAmount: money(hold.amount), currency: "USD" },
          }),
        });
      }
      const processing = body.processingInformation;
      const payment = body.paymentInformation;
      const order = body.orderInformation;
      const details = object(order) && object(order.amountDetails) ? order.amountDetails : undefined;
      const instrument = object(payment) && object(payment.paymentInstrument) ? payment.paymentInstrument.id : undefined;
      const amount = details && cents(details.totalAmount);
      if (!object(processing) || processing.capture !== false || !object(payment) || Object.keys(payment).some((key) => key !== "paymentInstrument") ||
          !details || details.currency !== "USD" || !amount || typeof instrument !== "string" || !Object.hasOwn(scenario.instruments, instrument)) return fail(res);
      const position = positions.get(instrument) ?? 0;
      const outcome: Outcome | undefined = scenario.instruments[instrument]?.[position];
      if (!outcome) return fail(res, 409);
      positions.set(instrument, position + 1);
      events.push({ operation: "authorize", outcome });
      // timeout means the request stalls BEFORE authorization: no hold is created by this scripted scenario.
      if (outcome === "timeout") return;
      if (outcome === "invalid") return fail(res, 400, "MISSING_FIELD");
      if (outcome === "partial" && amount < 2) return fail(res, 400, "INVALID_AMOUNT");
      const authId = `sim${String(nextId++).padStart(8, "0")}`;
      const authorized = outcome === "partial" ? Math.max(1, Math.floor(amount / 2)) : amount;
      if (outcome !== "decline") holds.set(authId, { amount: authorized, status: "authorized" });
      const status = { authorize: "AUTHORIZED", decline: "DECLINED", partial: "PARTIAL_AUTHORIZED", review: "AUTHORIZED_PENDING_REVIEW" }[outcome];
      return send(res, 201, "PtsV2PaymentsPost201Response", {
        id: authId, status, submitTimeUtc: now().toISOString(),
        ...(outcome === "decline" ? { errorInformation: { reason: "PROCESSOR_DECLINED", message: `${SIMULATOR_LABEL}: simulated decline` } } : {
          orderInformation: { amountDetails: { totalAmount: money(amount), authorizedAmount: money(authorized), currency: "USD" } },
        }),
      });
    } catch {
      if (!res.headersSent && !res.destroyed) fail(res);
    }
  });
  server.requestTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Visa Acceptance simulator: could not bind loopback");
  url = `http://127.0.0.1:${address.port}`;
  return {
    url, provider: SIMULATOR_LABEL, simulated: true as const,
    snapshot: () => ({ provider: SIMULATOR_LABEL, simulated: true as const, holds: [...holds].map(([id, hold]) => ({ id, ...hold })), events: structuredClone(events) }),
    close: () => new Promise<void>((resolve, reject) => { server.close((err) => err ? reject(err) : resolve()); server.closeAllConnections(); }),
  };
}
