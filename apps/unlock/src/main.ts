import { serve } from "@hono/node-server";
import { createApp, loadConfig } from "./app.js";

const config = loadConfig();
const app = createApp(config);
serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" });
