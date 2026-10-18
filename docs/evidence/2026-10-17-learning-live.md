# B3 — Real-model learning acceptance, 2026-10-17

Status: **not run**, pending B1 model access. This is not 0/6 failing business scenarios and not a 6/6 live pass. The single newly authorized OpenRouter preflight returned 403 even with unrestricted ZDR provider fallback; see [B1](2026-10-17-openrouter-live.md).

The existing six-scenario probe has passed against real isolated SQLite/rules/Git with a **synthetic extractor**. Its assertions remain acceptance requirements:

| Scenario | Real-model status |
| --- | --- |
| Explicit statement reaches card | Not run: extraction unavailable |
| Same agent, two independent conversations | Not run: extraction unavailable |
| Independent conversations after 31 days | Not run: extraction unavailable |
| Pause/resume drops a late result | Not run with real model |
| Queued original never reaches SQLite/WAL | Deterministic storage assertion; no model required; prior isolated pass |
| Cross-agent fixture accept preserves history | Deterministic authorization/history assertion; no model required; prior isolated pass |

Future live execution must inject the actual OpenRouter extractor into the model-dependent scenarios, preserve the original acceptance assertions, label the remaining deterministic checks, and never fall back to synthetic preferences after a provider failure. Only synthetic owner inputs may be sent; sensitive/group checks must make zero model calls. Do not rerun live calls periodically while access is unchanged.
