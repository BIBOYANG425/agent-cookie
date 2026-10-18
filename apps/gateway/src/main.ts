// Entry point: 127.0.0.1 only (TLS and the public host are the reverse proxy's job). Never prints a key or the secret.
import { serve } from "@hono/node-server";
import { createGateway } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const gateway = createGateway(config);
const server = serve({ fetch: gateway.app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[gateway] listening on http://${config.host}:${info.port} (origin ${config.origin}, rpId ${config.rpId}, test=${config.test ? 1 : 0})`);
});

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  // Stop accepting; open streams end when their instance stops.
  server.close();
  try {
    await gateway.close();
    process.exit(0);
  } catch {
    process.exit(1);
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
