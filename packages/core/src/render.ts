// CARD.md rendering and contributions/*.md parsing, in Agent Memory Repo's "one bullet per line + [key: value]" format. T0-9.
import type { Card, Contribution } from "./types.js";

export function renderCard(card: Card): string {
  void card;
  throw new Error("renderCard: implemented by the core subagent (T0-9)");
}

export function renderContribution(c: Contribution): string {
  void c;
  throw new Error("renderContribution: implemented by the core subagent (T0-9)");
}

export function parseContributions(markdown: string, userId: string, agentId: string): Contribution[] {
  void markdown; void userId; void agentId;
  throw new Error("parseContributions: implemented by the core subagent (T0-9)");
}
