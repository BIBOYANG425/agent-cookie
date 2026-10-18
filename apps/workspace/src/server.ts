// Entry point: 127.0.0.1 only (plan §1 技术栈与约束). Never prints keys.
// For a supervisor (the hosted gateway runs one instance per person, packages/contract/src/gateway.ts): PORT may be any
// port (0 = the OS picks); once the listener accepts connections exactly one stdout line starts with LISTENING, and
// <dataDir>/owner.key (when this instance mints one) is on disk before it; SIGTERM or SIGINT closes the listener and
// SQLite (deps.close) and exits 0, or 1 if closing failed.
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDeps } from "./deps.js";
import { flushTelemetry, initTelemetry } from "./telemetry.js";

/** `${LISTENING}<port>`: the line a supervisor waits for. Nothing else is printed on it. */
const LISTENING = "[workspace] listening on http://127.0.0.1:";

const config = loadConfig();
if (config.sentryDsn) initTelemetry({ dsn: config.sentryDsn, environment: config.sentryEnvironment, tracesSampleRate: config.sentryTracesSampleRate });
const deps = await createDeps(config);
const app = createApp(deps);
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`${LISTENING}${info.port}`);
  console.log(`[workspace] seed=${config.seed} ucp=${config.ucpMode} pay=${config.pay} sentry=${config.sentryDsn ? 1 : 0} ` +
    `demo=${config.demo ? 1 : 0} test=${config.test ? 1 : 0} fixtures=${config.fixturesDir}`);
});

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  let code = 0;
  try {
    server.close();
    await deps.close();
    await flushTelemetry();
  } catch (err) {
    console.error("[workspace] shutdown failed:", err);
    code = 1;
  }
  process.exit(code);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
