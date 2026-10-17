---
name: agent-cookie
description: Use the local Agent Cookie CLI to read your user's saved preferences, record explicitly stated preferences, and request external services through the workspace. Applies to personal agents with a configured Agent Cookie workspace.
---

# Agent Cookie for personal agents

The workspace owns policy, grants, expiry, revocation, and memory merging. Use its CLI; this skill does not implement or override those rules.

## Check the integration first

Run `agent-cookie --help`. The CLI is owned by lane B; the workspace by lane A. The current scaffold only implements `card`; other commands below are planned and must appear in help before use. If unavailable, report the missing integration. Do not create a replacement client, edit `CARD.md`, inspect SQLite, or manufacture successful results.

Use `AGENT_COOKIE_URL` and `AGENT_COOKIE_KEY` from the local environment. Never print the key. Confirm each subcommand's current `--help` before supplying flags; this repository's CLI contract is still being delivered.

## Use saved context for the user's task

- At the start of a relevant session, `agent-cookie card` reads the user's own card. A missing value is unknown, not permission to guess.
- When the user explicitly states a stable preference, use `agent-cookie contribute` with the supported arguments. Temporary budget and deadline belong to the current intent, not automatically to long-term memory. Do not promote model inferences into facts.
- For an authorized external service request, use `agent-cookie find`. Send only the task information allowed by its contract. Do not paste the full identity card into a merchant message; let the workspace provide the handshake and enforce field access.
- Use `agent-cookie accept` only for the quote the user selected or an action already covered by their explicit instructions. A successful tool response can mean handoff, not a completed purchase. Read its returned status.
- Use `agent-cookie receipts` to explain who accessed which fields and why. Use `agent-cookie revoke` when requested, then check the result. Revocation prevents future workspace reads; it does not recall information already sent.

There is no additional approval for each field read: the workspace checks existing policy and task authorization. The skill must not grant new permission by changing a purpose string or inventing an identity.

## Handle uncertainty honestly

Preserve Sample and Recorded run labels. Do not invent inventory, size conversions, arrival dates, quotes, receipts, or orders. `requires_escalation` means the user must continue at the returned merchant link; missing or failed checkout is not payment success.

On `AUTH_REQUIRED`, fix configuration. On `GRANT_EXPIRED` or `GRANT_REVOKED`, stop using that grant. On `SCOPE_DENIED` or `PURPOSE_MISMATCH`, do not retry with broader access or a misleading purpose. Keep raw errors, credentials, and private field values out of shared logs.
