export type Outcome = "authorize" | "decline" | "partial" | "review" | "invalid" | "timeout";
export interface Scenario { instruments: Record<string, Outcome[]> }
const outcomes = new Set<Outcome>(["authorize", "decline", "partial", "review", "invalid", "timeout"]);

export function parseScenario(input: unknown): Scenario {
  const instruments = (input as Partial<Scenario> | null)?.instruments;
  if (!instruments || typeof instruments !== "object" || Array.isArray(instruments)) throw new Error("Visa Acceptance simulator: invalid scenario");
  for (const [id, steps] of Object.entries(instruments)) {
    if (!/^[A-Za-z0-9]{16,64}$/.test(id) || !/[A-Za-z]/.test(id) || !Array.isArray(steps) || steps.length === 0 || steps.some((step) => !outcomes.has(step))) {
      throw new Error("Visa Acceptance simulator: invalid instrument script");
    }
  }
  return structuredClone({ instruments });
}
