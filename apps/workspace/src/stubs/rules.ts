// In-process stub of RulesApi until packages/rules (lane C) lands. Same behaviour the contract specifies;
// lane C may lift merge.ts / render.ts / session.ts and their tests as a starting point.
import type { RulesApi } from "@agent-cookie/contract";
import { mergeCard } from "./merge.js";
import { parseContributions, renderCard, renderContribution } from "./render.js";
import { deriveSessionId } from "./session.js";

export const stubRules: RulesApi = {
  mergeCard: (contributions, options) => mergeCard([...contributions], options),
  deriveSessionId,
  renderCard,
  renderContribution,
  parseContributions: (markdown, owner) => parseContributions(markdown, owner.userId, owner.agentId),
};
