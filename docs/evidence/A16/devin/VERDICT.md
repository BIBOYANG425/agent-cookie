# Verdict (corrected wording; raw results unchanged)

- **A16 / C11: BLOCKED.** The planned A16 needs a full MemoryStore. The frozen merchant HTTP contract has no way to list, delete or clear notes, and no durable generation with a conditional write. `build_memory_store()` raises `ContractUnavailable`, and with `AGENT_COOKIE_MEMORY=tier2` the retail host fails at startup.
- **Passed: 29/29 HTTP checks of a limited preferences/note integration** against the unmodified workspace. The adapter read the authorized fields, wrote this merchant's own note, read it back, checked isolation, and failed closed on revoke and expiry.
- `20-http/results.json` and `run-stdout.txt` are the raw output and are not edited. Their `"a16_core": true` is the driver's label for the 3 checks "fields read + note PUT + note read back". It does **not** mean A16 passed.
- Chat is unverified (no ANTHROPIC_API_KEY).
