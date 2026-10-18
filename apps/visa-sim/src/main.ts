import { readFileSync } from "node:fs";
import { startSimulator, parseScenario } from "./index.js";

async function main() {
  const port = Number(process.env.VISA_SIM_PORT ?? "4313");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Visa Acceptance simulator: invalid VISA_SIM_PORT");
  const scenario = process.env.VISA_SIM_SCENARIO ? parseScenario(JSON.parse(readFileSync(process.env.VISA_SIM_SCENARIO, "utf8"))) : undefined;
  const credentials = process.env.VISA_ACCEPTANCE_MERCHANT_ID || process.env.VISA_ACCEPTANCE_KEY_ID || process.env.VISA_ACCEPTANCE_SHARED_SECRET
    ? { merchantId: process.env.VISA_ACCEPTANCE_MERCHANT_ID!, keyId: process.env.VISA_ACCEPTANCE_KEY_ID!, sharedSecret: process.env.VISA_ACCEPTANCE_SHARED_SECRET! }
    : undefined;
  if (credentials && (!credentials.merchantId || !credentials.keyId || !credentials.sharedSecret)) throw new Error("Visa Acceptance simulator: configure all three credential variables or none");
  const sim = await startSimulator({ ...(scenario ? { scenario } : {}), ...(credentials ? { credentials } : {}) }, port);
  console.log(JSON.stringify({ provider: sim.provider, simulated: true, url: sim.url }));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void sim.close().then(() => process.exit(0)); });
}

void main().catch(() => {
  console.error(JSON.stringify({ provider: "Visa Acceptance simulator", simulated: true, result: "startup failed" }));
  process.exitCode = 1;
});
