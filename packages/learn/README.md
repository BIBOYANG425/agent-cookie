# Conversation preference extraction — lane B

`createWorkspaceLearner({extract, classify?, mode?, telemetry?})` implements A's actual `LearnApi`. A owns the runtime import in `apps/workspace/src/adapters.ts`; B does not write the workspace, rules, card or Git repository. The default policy is a safe subset of the contract's `PREF_FIELDS`; financial price bands and relationship recipients are excluded. An injected policy is still intersected with that whitelist. Unknown keys are dropped, not created from a prefix.

```ts
import { createWorkspaceLearner, createHaikuExtractor, createJevClassifier, createLearningTelemetry } from '@agent-cookie/learn';
const telemetry = createLearningTelemetry({ endpoint: process.env.AGENT_COOKIE_LEARNING_OTLP_ENDPOINT });
const learn = createWorkspaceLearner({
  extract: createHaikuExtractor({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  ...(process.env.JEV_API_KEY ? { classify: createJevClassifier({ apiKey: process.env.JEV_API_KEY }) } : {}),
  mode: process.env.AGENT_COOKIE_LEARN_MODE === 'explicit-only' ? 'explicit-only' : 'all',
  telemetry: telemetry.metric,
});
// A injects learn and calls telemetry.shutdown() on shutdown.
```

No key is read automatically by the library; a missing key must not silently enable synthetic results. Model is pinned to `claude-haiku-4-5-20251001`. Jev uses `/v1/systemone` typed noul questions. Missing/unavailable Jev falls back to Haiku; a negative or uncertain safety verdict does not. Zod validates model envelopes, allowed keys, conclusions, basis and evidence. Evidence must be a literal substring of the owner's words and at most 200 Unicode code points. Outputs contain conclusions/evidence only; errors are fixed public text.

An OpenRouter key is an alternative to the direct Anthropic credential:

```ts
const extract = createHaikuExtractor({
  provider: 'openrouter',
  apiKey: process.env.OPENROUTER_API_KEY!,
});
```

OpenRouter uses its canonical `anthropic/claude-haiku-4.5` alias; it is not a guarantee of Anthropic's dated snapshot ID. Requests require strict structured output, pin the provider endpoint to `amazon-bedrock/us`, disable provider fallback, deny data collection and require ZDR. First-party Anthropic is not available under OpenRouter's ZDR policy; the published [ZDR endpoint list](https://openrouter.ai/api/v1/endpoints/zdr) includes Bedrock US for this model. If this combination is unavailable, extraction returns no learned output; it does not relax retention or switch models. The accepted owner text is sent to OpenRouter and Amazon Bedrock for Haiku extraction; neither OTel nor the jar should receive the whole input. Keep account input/output logging disabled. See [OpenRouter Haiku](https://openrouter.ai/anthropic/claude-haiku-4.5/api), [ZDR policy](https://openrouter.ai/docs/guides/features/zdr), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), and [routing controls](https://openrouter.ai/docs/guides/routing/provider-selection).

Live synthetic check on 2026-10-17: credential authentication returned 200, but extraction returned 403 after the ZDR routing correction. No real-model extraction is claimed. Do not automatically retry account/access failures or relax routing; resolve access with the provider first. Offline protocol tests remain available without credentials.

Local setup: put `OPENROUTER_API_KEY` in a Git-ignored `.env.openrouter` at the repository root, restrict that file to owner read/write, and never send its contents to chat. The library does not auto-load it. With Node22, from the root:

```sh
pnpm --filter @agent-cookie/learn build
# Offline protocol check: no credential or network needed.
node packages/learn/scripts/check-openrouter.mjs --offline
# Explicit live check: one bounded Haiku request, synthetic sentence only.
node --env-file=.env.openrouter packages/learn/scripts/check-openrouter.mjs
```

The check rejects a synthetic sensitive sentence and other group speaker before any model call, then tests one explicit color preference. Output contains only status, timing, call count and extracted field names; no key, original response, real conversation or workspace write. A successful check proves the model adapter, not production learning, card promotion, historical erasure or Spectrum delivery. The remaining A/C dependencies still apply.

The first filter rejects non-owner/group/merchant/assistant inputs, sensitive topics (health, religion, finance, relationships, whereabouts), personal identifiers, quotations and prompt-instruction text. The model also classifies sensitivity. `extractFromConversation` rejects the entire supplied batch if one owner turn is sensitive; it never concatenates other speakers. Overlarge batches (>4000 total characters) fail closed rather than hiding a sensitive portion by truncation. The intent adapter only uses `input.text`, never a merchant's quote or a model-invented query. This conservative filter is not a general natural-language safety proof; real-model quality still needs evaluation, and unsupported/ambiguous material should produce no preference.

The total learner deadline is 10 seconds, Jev at most 1.5s, Haiku at most 8s. Cancellation and adapters that ignore signals are bounded. `explicit-only` is the H14 fallback: first-person explicit rules plus Haiku `stated` confirmation, no Jev or candidate path. No model → no learned output. Promotion remains A/C's deterministic decision. C 688754d resolved the evidence shape and intent author mismatch (B45/B46); A's stated downgrade, raw observation persistence and pause/forget race still block live learning under B44.

OTel uses `createIsolatedOtel`, separate providers and an explicit endpoint; no global fetch instrumentation or message bodies. Only stage/status/count/duration are constructed for traces and logs. An actual local OTLP receiver tests both export streams for canary body/phone/email/value leakage. Automatic Photon phone/email scrubbing alone is not the privacy boundary. No endpoint means no exporter. Sentry account receipt is not yet verified.

Offline fixtures are **synthetic-protocol-fixture**, not live model recordings. Run `pnpm --filter @agent-cookie/learn test`, `typecheck`, `build` from the root with Node22. The repository uses TypeScript7; Spectrum/OTel declare a TypeScript5/6 peer range. Builds pass, but that peer warning remains and a live cloud session is not validated.

Estimated Haiku cost: 800–2000 input +150–200 output tokens at $1/M input and $5/M output ≈$0.00155–0.003 per extraction. At 100 messages/day and an assumed10% reaching the model, approximately $0.47–0.90 per month. Jev cost is unverified. These are planning estimates, not measured billings or latency. Sources: https://platform.claude.com/docs/en/models/haiku-4-5/overview, https://api.typesafe.ai/redoc, https://github.com/photon-hq/otel.
