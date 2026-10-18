import { startSimulator, SAMPLE_CREDENTIALS } from "@agent-cookie/visa-sim";
import { visaProvider } from "../src/visa.js";

process.env.VISA_ACCEPTANCE_SIMULATOR = "1";
const sim = await startSimulator();
try {
  const provider = visaProvider({ ...SAMPLE_CREDENTIALS, host: sim.url });
  const result = await provider.authorize({ amount: 100, currency: "USD", paymentMethodRef: "tms_SampleAuthorizeInstrument", idempotencyKey: "SampleSmoke" });
  if (result.status !== "authorized" || result.authorizedAmount !== 100) throw new Error("authorization failed");
  await provider.reverse!(result.providerRef, result.authorizedAmount, "USD");
  if (sim.snapshot().holds.some((hold) => hold.status === "authorized")) throw new Error("simulated hold remains");
  console.log(JSON.stringify({ provider: provider.label, simulated: true, authorization: "authorized", reversal: "reversed", result: "passed" }));
} catch {
  console.error(JSON.stringify({ provider: "Visa Acceptance simulator", simulated: true, result: "failed" }));
  process.exitCode = 1;
} finally {
  await sim.close();
}
