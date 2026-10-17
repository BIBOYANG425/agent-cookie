// Live UCP smoke (plan T4/T8): against a RUNNING workspace started with AGENT_COOKIE_UCP=live.
//   two real quotes → accept one → handoff link; and the Sample-address guard: while the card holds a Sample
//   address, accept must hand off WITHOUT reading it (no shipping_address receipt) — it is never sent to a real store.
// Usage: AGENT_COOKIE_URL=http://127.0.0.1:4310 AGENT_COOKIE_KEY=<personal key> pnpm --filter @agent-cookie/workspace smoke:live [--out file.json]
// Prints a redacted JSON summary (sellers, prices, statuses, continue URL host); never prints keys or the address.
// Exit 0 = all checks passed; 1 = a check failed; 2 = could not run (no live quotes: network, CLI, catalog).
import { writeFileSync } from "node:fs";

const base = process.env.AGENT_COOKIE_URL ?? "http://127.0.0.1:4310";
const key = process.env.AGENT_COOKIE_KEY;
const outIdx = process.argv.indexOf("--out");
const out = outIdx > 0 ? process.argv[outIdx + 1] : undefined;
if (!key) {
  console.error("AGENT_COOKIE_KEY (a personal agent key) is required");
  process.exit(2);
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await fetch(new URL(path, base), {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}

const checks: Array<{ check: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => { checks.push({ check: name, ok, ...(detail ? { detail } : {}) }); return ok; };
const summary: Json = { at: new Date().toISOString(), workspace: base, checks };
const finish = (code: number) => {
  summary.result = code === 0 ? "pass" : code === 1 ? "fail" : "not run";
  const text = JSON.stringify(summary, null, 2);
  console.log(text);
  if (out) writeFileSync(out, `${text}\n`);
  process.exit(code);
};

const card = await call("GET", "/personal/card");
if (card.status !== 200) { summary.error = `GET /personal/card → ${card.status}`; finish(2); }
const address = (card.body.card as Json[]).find((f) => f.field === "shipping_address");
summary.cardAddressSource = address ? (address.source ?? card.body.source ?? "unknown") : "none";
const sampleAddress = Boolean(address && /\bsample\b/i.test(String(address.value)));
summary.cardAddressIsSample = sampleAddress;

const intent = await call("POST", "/personal/intents", { kind: "trail_shoes", text: "live smoke: trail running shoes" });
summary.intent = { status: intent.status, introduced: intent.body?.introduced, error: intent.body?.error?.code };
if (intent.status !== 201) finish(2);
const quotes = await call("GET", `/personal/intents/${intent.body.intentId}/quotes?wait=20000`);
const ucpQuotes = ((quotes.body?.quotes ?? []) as Json[]).filter((q) => q.seller);
summary.quotes = ucpQuotes.map((q) => ({ seller: q.seller, title: q.title, price: q.price, source: q.source, variantId: q.variantId }));
if (ucpQuotes.length === 0) { summary.error = "no UCP quotes (live catalog unreachable or empty)"; finish(2); }
if (!check("all quotes are live (not fixture)", ucpQuotes.every((q) => q.source === "live"),
  ucpQuotes.map((q) => q.source).join(","))) finish(1);
check("two quotes from two different sellers", ucpQuotes.length >= 2 && new Set(ucpQuotes.map((q) => q.seller)).size >= 2);

const chosen = ucpQuotes[0];
const accept = await call("POST", `/personal/quotes/${chosen.id}/accept`);
const r = accept.body ?? {};
summary.accept = { seller: chosen.seller, status: r.status, code: r.code, message: r.message,
  continueUrlHost: typeof r.continueUrl === "string" ? new URL(r.continueUrl).host : undefined };
check("accept is a handoff with an https continue URL", r.status === "handoff" && /^https:\/\//.test(String(r.continueUrl ?? "")));
check("accept is never reported as ordered", r.status !== "ordered" && r.orderId === undefined);

const receipts = await call("GET", "/personal/receipts?limit=200");
const addressReads = ((receipts.body?.receipts ?? []) as Json[])
  .filter((x) => x.agentId === `ucp:${chosen.seller}` && (x.fields as string[]).includes("shipping_address"));
summary.addressReceipts = addressReads.length;
if (sampleAddress) {
  check("Sample address was not read for the real store (no shipping_address receipt)", addressReads.length === 0);
  check("the user is told why no address was sent", /sample address/i.test(String(r.message ?? "")));
}
finish(checks.every((c) => c.ok) ? 0 : 1);
