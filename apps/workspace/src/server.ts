// Entry point: 127.0.0.1 only (plan §1 技术栈与约束). Never prints keys.
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDeps } from "./deps.js";
import { flushTelemetry, initTelemetry } from "./telemetry.js";

const config = loadConfig();
if (config.sentryDsn) initTelemetry({ dsn: config.sentryDsn, environment: config.sentryEnvironment, tracesSampleRate: config.sentryTracesSampleRate });
const deps = await createDeps(config);
const app = createApp(deps);
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`agent-cookie workspace listening on http://${config.host}:${info.port} ` +
    `(ucp=${config.ucpMode}, sentry=${config.sentryDsn ? 1 : 0}, demo=${config.demo ? 1 : 0}, test=${config.test ? 1 : 0}, fixtures=${config.fixturesDir})`);
});

const shutdown = async () => {
  server.close();
  await deps.close();
  await flushTelemetry();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
