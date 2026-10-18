# Conversation preference extraction — lane B

The team pipeline now uses **OpenRouter only**: local filters → `typesafe/jev-1.14` → `openai/gpt-oss-120b`. Models classify and extract; A/C make deterministic authorization, promotion and revocation decisions. No model means no invented preferences.

```ts
import { createExtractor, createWorkspaceLearner, createLearningTelemetry } from '@agent-cookie/learn';
const telemetry = createLearningTelemetry({ endpoint: process.env.AGENT_COOKIE_LEARNING_OTLP_ENDPOINT });
const extract = createExtractor({ apiKey: process.env.OPENROUTER_API_KEY! });
const learn = createWorkspaceLearner({ extract, telemetry: telemetry.metric,
  mode: process.env.AGENT_COOKIE_LEARN_MODE === 'explicit-only' ? 'explicit-only' : 'all' });
// A injects learn and closes telemetry on shutdown. Keys stay in local ignored env files.
```

`createExtractor` carries its companion Jev classifier; `createLearner` and `createWorkspaceLearner` automatically use it unless an explicit classifier is injected. Synthetic test extractors do not enable any real requests. No key is loaded automatically. `createHaikuExtractor` remains a compatibility function for A's existing import, but now delegates to `createExtractor`; its name does not describe the selected model. Direct Anthropic requests are disabled. A's existing `learnProvider=openrouter` is sufficient; the workspace source was not changed.

`AGENT_COOKIE_LEARN_MODEL` selects one of:

- `openai/gpt-oss-120b` (default; real validation recorded below)
- `qwen/qwen3-235b-a22b-2507`
- `meta-llama/llama-3.3-70b-instruct`

An explicit `createExtractor({apiKey, model})` overrides the env value. Unknown model IDs fail configuration. The latter two are selectable alternatives, not automatic cross-model fallbacks and not yet live-validated. `getExtractorDefaults(extract)` exposes the selected model/classifier identity without credentials. The formal B60 contract now accepts `ContributionEvidence.models?: { gate?, extractor? }`. B attaches the known extractor ID and only a gate that actually accepted the turn; an unavailable Jev fallback omits `gate`, and custom adapters do not receive invented model identities. The SDK validates and preserves this field from the workspace. A persists it in SQLite and exposes it through `/personal/learned`; C still needs the `gate:` / `extractor:` Git codec and console display. Metadata never grants permission or changes promotion. Do not stuff a model name into a user-evidence snippet or writer ID.

## Jev wire protocol and gate

The [OpenRouter Jev reference](https://openrouter.ai/docs/guides/community/jev) and [Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request) specify **`POST https://openrouter.ai/api/alpha/decisions`**, not chat completions. Live HTTP 200 confirmed this format on 2026-10-17. No separate Jev key/account or direct TypeSafe call is used.

```ts
{
  model: 'typesafe/jev-1.14',
  provider: { zdr: true, data_collection: 'deny', allow_fallbacks: true, require_parameters: true },
  state: { utterance: ownerText },
  questions: {
    stable: { type: 'noul', instructions: 'Does the speaker express their own stable preference or fact?' },
    sensitive: { type: 'noul', instructions: 'Health, religion, finances, relationships or whereabouts? Uncertain safety means yes.' },
    key: { type: 'choice', instructions: 'Which supported preference?', criteria: { 'pref.color': 'Clothing color', none: 'None' } }
  }
}
```

The real response has `model`, `provider`, `answers`, `usage`, `id`; each noul answer contains a probability, and the choice contains `choice`, `confidence`, `probabilities`. The three questions share **one request per eligible owner turn**, not three requests. A batch is processed one owner turn at a time; other speakers are not concatenated into it. Any locally sensitive owner turn rejects the batch before requests. A Jev-sensitive turn drops the batch's results.

Gate thresholds are explicit demo policy: stable ≥0.90; sensitive ≤0.10; selected whitelisted key confidence and selected probability both ≥0.90. Anything above the sensitive threshold, including uncertainty, is a hard stop. Missing/malformed safety is also a stop, parsed before the other answers. The extracted schema's key enum is narrowed to the selected key. A negative/uncertain decision never falls back. Only unavailable Jev (transport/non-2xx/timeout) permits extraction after the local rules; the extractor independently checks sensitivity too. These probabilities are not calibrated safety guarantees. Sensitive local-filter tests and malformed/positive Jev safety tests assert zero extractor calls.

## Extraction, privacy and bounds

Chat completions uses strict `response_format.json_schema`, `additionalProperties:false`, a maximum of five items, bounded values/evidence, and Zod validation. Turns failing the local explicit-statement check also exclude `stated` from the wire schema; candidates remain observed/inferred. A truncated/refused response is rejected. Conclusions must use allowed `pref.*` keys; evidence is an exact substring of that owner's turn and ≤200 Unicode characters. Local validation rejects sensitive values, fabricated evidence, unsupported keys and false `stated` attribution. A/C's whitelist is an upper bound; price-band and recipient fields are excluded under the human's sensitive-topic rule.

答辩说明：模型不能自行把顺口提到的偏好升级成“明确陈述”；本地谓词不认定为明确陈述时，请求的 JSON schema 就只允许 `observed` / `inferred`，让结果先进入候选，返回结果仍须通过本地校验，并按两段独立对话的规则晋升。

Both requests require `zdr:true`, `data_collection:"deny"`, `require_parameters:true` and permit fallback **only between eligible ZDR providers**, with no `only` pin. Extraction sorts eligible providers by latency. A failed provider does not authorize a different model, weaker retention, or synthetic output. The accepted owner text goes to OpenRouter and the selected provider; it must not be copied into jar, logs, traces or evidence files. See [ZDR endpoints](https://openrouter.ai/api/v1/endpoints/zdr), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [routing](https://openrouter.ai/docs/guides/routing/provider-selection).

The registered model pipeline has a 30s total deadline, Jev ≤1.5s and extraction ≤28s, with cancellation and late-result discard. Synthetic/custom extractors keep their prior 10s default. The H14 `explicit-only` mode rejects incidental input locally, still respects Jev safety, and accepts only locally confirmed `stated` outputs. No sensitive/group/merchant/assistant input is eligible. A 4,000-character total batch bound is preserved.

Workspace collection is explicitly enabled by A's `AGENT_COOKIE_LEARN_PROVIDER=openrouter` (default off). Merely having an API key never enables collection. Dreaming/queue/forget behavior belongs to A/C. This package does not read all iMessage chats, persist transcripts, or modify the live phone listener.

## Validation and cost

Put `OPENROUTER_API_KEY` in local ignored `.env.openrouter`, owner-only permissions. From the repository root using Node22:

```sh
pnpm --filter @agent-cookie/learn build
node packages/learn/scripts/check-openrouter.mjs --offline
# Real synthetic statement: one Jev request + one gated extraction, no workspace writes.
node --env-file=.env.openrouter packages/learn/scripts/check-openrouter.mjs
# Six scenarios; real temporary SQLite/Git, synthetic user inputs, real model adapters.
cd packages/sdk
node --env-file=../../.env.openrouter --import tsx test/learning-acceptance.check.ts --live
```

Offline protocol fixtures are labeled synthetic. Do not call them live model recordings. The six-scenario runner retains its original pass conditions; it additionally reports actual model calls and latency per scenario. Queue-on-disk and commerce-history checks need no model calls. The extra capture acceptance is still explicitly synthetic. Access errors stop subsequent live requests. Reports omit original request/response text and credentials.

The first Jev probe: HTTP200, 402ms end-to-end, 384 input tokens, $0.000016128. The first gpt-oss probe returned HTTP200 but `finish_reason=length`; it failed validation and was not treated as success. With a bounded schema and latency-based ZDR routing, the subsequent complete pipeline passed: Jev355ms/$0.000017514 + gpt-oss1193ms/$0.00004915, total1557ms/$0.000066664. See `docs/evidence/2026-10-17-learning-live.md` for the six scenarios and full scope.

The public Jev price checked this date is $0.042/M input tokens and $0 output. A 400–1,000-input-token gate is about $0.0000168–$0.000042 (one thousand such gates ~$0.017–$0.042). Extraction runs only on accepted turns, except the explicitly documented Jev-unavailable fallback. GPT-oss prices depend on eligible provider; use returned `usage.cost`, not a universal price. The often-quoted “~50ms” is not our measured network latency: initial end-to-end Jev checks took355–402ms. Costs and latency above are small-sample measurements, not an SLA or zero-cost promise.

## Telemetry

`createLearningTelemetry` uses isolated Photon OTel, not global fetch instrumentation. Only allowlisted stage/status/count/duration leave the pipeline. No message bodies, evidence, values, phone numbers or emails are emitted. No configured endpoint means no exporter. Local OTLP trace/log canary tests cover leakage; external Sentry delivery and Spectrum Cloud collection are separate, unverified deployments.
