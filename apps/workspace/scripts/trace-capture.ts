// Offline Sentry trace capture (T8 evidence while sentry.io is unreachable): runs one intent + accept on the real
// wiring (fixture-mode UCP replaying lane D's recordings, lane C's seed, a temp git memory repo) with the Sentry SDK
// initialised against a capture transport, then writes the spans the SDK would have sent (--json) and a waterfall
// view of the accept trace (--html). Not a Sentry UI screenshot; the page says so.
// Usage: pnpm --filter @agent-cookie/workspace exec tsx scripts/trace-capture.ts --json out.json --html out.html
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/node";
import { createApp } from "../src/app.js";
import { loadConfig, REPO_ROOT } from "../src/config.js";
import { createDeps } from "../src/deps.js";
import { flushTelemetry, initTelemetry } from "../src/telemetry.js";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const bodies: string[] = [];
initTelemetry({ dsn: "https://public@o0.ingest.example.invalid/1", environment: "offline-capture", tracesSampleRate: 1,
  transport: (o) => Sentry.createTransport(o, async (req) => {
    bodies.push(typeof req.body === "string" ? req.body : Buffer.from(req.body).toString("utf8"));
    return { statusCode: 200 };
  }) });

const tmp = mkdtempSync(join(tmpdir(), "ac-trace-"));
const config = loadConfig({ SQLITE_PATH: ":memory:", MEMORY_REPO_PATH: join(tmp, "memory"), AGENT_COOKIE_UCP: "fixture", AGENT_COOKIE_DEMO: "1" });
const deps = await createDeps(config);
const app = createApp(deps);
const devKeys = JSON.parse(readFileSync(join(REPO_ROOT, "fixtures/dev-keys.json"), "utf8")) as Record<string, { agentId: string; role: string }>;
const key = Object.entries(devKeys).find(([, v]) => v.role === "personal")![0];
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return res.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const pinned = JSON.parse(readFileSync(join(config.ucpFixturesDir, "pinned.json"), "utf8"));
const intent = await call("POST", "/personal/intents", { kind: "trail_shoes", public: { budget: String(pinned.budget), shoe_size: pinned.size } });
const { quotes } = await call("GET", `/personal/intents/${intent.intentId}/quotes?wait=5000`);
const quote = quotes.find((q: { seller?: string }) => q.seller === pinned.offers[0].seller);
const accept = await call("POST", `/personal/quotes/${quote.id}/accept`);
await deps.close();
await flushTelemetry();

type Span = { name: string; span_id: string; trace_id: string; parent_span_id?: string; is_segment: boolean; status: string;
  start_timestamp: number; end_timestamp: number; attributes: Record<string, { value: unknown }> };
const spans: Span[] = [];
for (const body of bodies) {
  const lines = body.split("\n").filter(Boolean);
  for (let i = 1; i + 1 < lines.length; i += 2) if (JSON.parse(lines[i]!).type === "span") spans.push(...JSON.parse(lines[i + 1]!).items);
}
const keep = ["sentry.op", "http.route", "http.response.status_code", "ucp.op", "ucp.mode", "ucp.seller", "ucp.status", "ucp.offers"];
const slim = spans.map((s) => ({ name: s.name, trace_id: s.trace_id, span_id: s.span_id, parent_span_id: s.parent_span_id, is_segment: s.is_segment,
  status: s.status, duration_ms: +((s.end_timestamp - s.start_timestamp) * 1000).toFixed(2), start: s.start_timestamp,
  attributes: Object.fromEntries(keep.filter((k) => s.attributes[k] !== undefined).map((k) => [k, s.attributes[k]!.value])) }));
const root = slim.find((s) => s.is_segment && s.name === "POST /personal/quotes/:id/accept")!;
const tree = slim.filter((s) => s.trace_id === root.trace_id).sort((a, b) => a.start - b.start);
const capture = { capturedAt: new Date().toISOString(), sdk: `@sentry/node ${Sentry.SDK_VERSION}`, ucpMode: config.ucpMode,
  acceptResult: { status: accept.status, continueUrlHost: accept.continueUrl ? new URL(accept.continueUrl).host : undefined },
  envelopes: bodies.length, spans: slim.length, acceptTrace: tree.map(({ start: _s, ...x }) => x) };
if (arg("--json")) writeFileSync(arg("--json")!, `${JSON.stringify(capture, null, 2)}\n`);

const t0 = root.start;
const total = Math.max(...tree.map((s) => (s.start - t0) * 1000 + s.duration_ms));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const rows = tree.map((s) => {
  const left = ((s.start - t0) * 1000 / total) * 100;
  const width = Math.max((s.duration_ms / total) * 100, 0.6);
  const attrs = Object.entries(s.attributes).filter(([k]) => k !== "sentry.op").map(([k, v]) => `${k}=${v}`).join("  ");
  return `<div class="row${s.is_segment ? " root" : ""}"><div class="label"><b>${esc(s.name)}</b><span>${esc(String(s.attributes["sentry.op"] ?? ""))} · ${s.duration_ms} ms · ${esc(s.status)}</span><small>${esc(attrs)}</small></div>
<div class="track"><div class="bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></div></div></div>`;
}).join("\n");
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Offline trace capture</title><style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--bar:#6c5fc7;--root:#2b7a4b;--line:#e5e5ea;--warn:#fff4d6}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.4 -apple-system,system-ui,sans-serif;width:1100px}
.banner{background:var(--warn);border:1px solid #e0c97a;padding:10px 14px;border-radius:6px;margin-bottom:16px}
h1{font-size:18px;margin:0 0 4px} .meta{color:var(--muted);margin-bottom:16px}
.row{display:grid;grid-template-columns:430px 1fr;gap:12px;align-items:center;border-top:1px solid var(--line);padding:8px 0}
.label b{display:block;font-family:ui-monospace,monospace;font-size:13px} .label span{color:var(--muted);font-size:12px;display:block}
.label small{color:var(--muted);font-family:ui-monospace,monospace;font-size:11px}
.track{position:relative;height:14px;background:#f5f5f7;border-radius:3px} .bar{position:absolute;top:0;bottom:0;background:var(--bar);border-radius:3px}
.root .bar{background:var(--root)} .row:not(.root) .label{padding-left:18px}
</style></head><body>
<div class="banner"><b>Offline capture — not a Sentry UI screenshot.</b> sentry.io is blocked by this environment's network policy (CONNECT 403), so these are the spans the Sentry SDK produced and would have sent, captured by a local transport. UCP ran in <b>fixture</b> mode (lane D's recorded responses), not live.</div>
<h1>POST /personal/quotes/:id/accept</h1>
<div class="meta">${esc(capture.sdk)} · trace ${esc(root.trace_id)} · ${tree.length} spans · accept → ${esc(String(accept.status))} (${esc(String(capture.acceptResult.continueUrlHost ?? ""))}) · captured ${esc(capture.capturedAt)}</div>
${rows}
</body></html>`;
if (arg("--html")) writeFileSync(arg("--html")!, html);
console.log(JSON.stringify({ spans: slim.length, acceptTrace: tree.map((s) => `${s.name} ${s.duration_ms}ms`), accept: capture.acceptResult }));
