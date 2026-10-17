---
name: agent-cookie
description: Use Agent Cookie to read saved preferences, observe the owner's non-sensitive everyday preferences, and request services through the workspace. Applies only to a configured personal agent.
---

# Agent Cookie for personal agents

The workspace owns policy, grants, expiry, revocation, and memory merging. Use its CLI; this skill does not implement or override those rules.

## Check the integration first

Run `agent-cookie --help`. The CLI is owned by lane B; the workspace by lane A. The current CLI only implements `card`; other CLI commands below are planned and must appear in help before use. When the Agent Cookie MCP is configured, `get_my_card`, `find_agents`, `accept_quote`, and `list_receipts` are implemented alternatives; inspect tool discovery before using them. If unavailable, report the missing integration. Do not create a replacement client, edit `CARD.md`, inspect SQLite, or manufacture successful results.

Use `AGENT_COOKIE_URL` and `AGENT_COOKIE_KEY` from the local environment. Never print the key. Confirm each subcommand's current `--help` before supplying flags; this repository's CLI contract is still being delivered.

## Use saved context for the user's task

- At the start of a relevant session, `agent-cookie card` reads the user's own card. A missing value is unknown, not permission to guess.
- If the MCP advertises `observe` and learning is enabled, submit the current owner's exact utterance when it supports a stable preference; the user need not say “remember.” Never submit a transcript, another participant, an assistant response, merchant speech, quotations, or health/religion/finance/relationships/whereabouts. If unsure about provenance, skip it. Never fabricate a source/conversation ID. Temporary budget and deadline belong to the task. Classification, whitelist and candidate promotion belong to the backend; a queued observation is not a saved fact. Continue the user's task if learning is unavailable.
- For an authorized external service request, use `agent-cookie find`. Send only the task information allowed by its contract. Do not paste the full identity card into a merchant message; let the workspace provide the handshake and enforce field access.
- Use `agent-cookie accept` only for the quote the user selected or an action already covered by their explicit instructions. A successful tool response can mean handoff, not a completed purchase. Read its returned status.
- Use `agent-cookie receipts` to explain who accessed which fields and why. Use `agent-cookie revoke` when requested, then check the result. Revocation prevents future workspace reads; it does not recall information already sent.

There is no additional approval for each field read: the workspace checks existing policy and task authorization. The skill must not grant new permission by changing a purpose string or inventing an identity.

## Handle uncertainty honestly

Preserve Sample and Recorded run labels. Do not invent inventory, size conversions, arrival dates, quotes, receipts, or orders. `requires_escalation` means the user must continue at the returned merchant link; missing or failed checkout is not payment success.

On `AUTH_REQUIRED`, fix configuration. On `GRANT_EXPIRED` or `GRANT_REVOKED`, stop using that grant. On `SCOPE_DENIED` or `PURPOSE_MISMATCH`, do not retry with broader access or a misleading purpose. Keep raw errors, credentials, and private field values out of shared logs.

For “forget X” or “pause learning,” stop submitting observations immediately. Use the console's learning controls or the configured iMessage commands; only report deletion/pause as confirmed after the workspace acknowledgement. Do not invent a CLI command or tool that discovery does not expose. The current learning endpoints remain an opt-in B proposal until A publishes the contract. A static Desktop MCP connection cannot prove two separate chat sessions: do not manufacture conversation boundaries or promote candidates yourself.
