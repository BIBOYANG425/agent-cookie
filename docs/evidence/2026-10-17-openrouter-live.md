# B1 — OpenRouter live preflight, 2026-10-17

Result: **blocked by HTTP 403; no validated live extraction**. One newly authorized synthetic request was sent. No complete request body, key, account identifier, or provider error payload is recorded here. No real conversation, workspace write, SMS, or order was involved.

## Endpoint and account checks

The public [ZDR list](https://openrouter.ai/api/v1/endpoints/zdr) contained six endpoints for `anthropic/claude-haiku-4.5`: `amazon-bedrock/us`, `amazon-bedrock/eu-west-1`, `amazon-bedrock/global`, `google-vertex/us-east5`, `google-vertex/europe`, and `google-vertex/global`. Therefore the task's condition for replacing Haiku (absent from the ZDR list) was not met.

The signed-in Settings → Privacy page showed empty Allowed Providers and Ignored Providers. It also explicitly displayed an account restriction on closed-weight Anthropic/Google/OpenAI models. No provider restriction was available to remove; no account privacy setting was changed. Public endpoint availability does not imply this account may use it.

## Minimal extraction attempt

The actual B adapter and Zod learner were used, with a fetch wrapper removing `provider.only` and setting `allow_fallbacks: true`. `require_parameters: true`, `data_collection: "deny"`, `zdr: true`, the same Haiku model and strict JSON schema remained enforced. This exact diagnostic is now reproducible using `check-openrouter.mjs --zdr-fallback`; it is not an automatic retry.

```json
{
  "mode": "live-synthetic-input",
  "model": "anthropic/claude-haiku-4.5",
  "routing": "any-zdr-with-fallback",
  "filtersPassed": true,
  "extractionPassed": false,
  "reason": "unavailable",
  "requests": 1,
  "httpStatuses": [403],
  "elapsedMs": 316,
  "extractedFields": []
}
```

Sensitive speech and another group speaker were rejected locally before the one model request. The model returned no extractable JSON, so Zod-valid live output was **not** achieved. Library routing defaults were not changed on the basis of a failed experiment. No account/region substitution, model switch or privacy relaxation was attempted. A real six-scenario run remains blocked; account access must change before another authorized attempt.
