// Pairwise session IDs — one per (user, agent). Not derivable from one another. docs/plan.md §4 T0-5.
export function deriveSessionId(userSecret: string, agentId: string): string {
  void userSecret; void agentId;
  throw new Error("deriveSessionId: implemented by the core subagent (T0-5)");
}
