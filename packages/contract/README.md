# @agent-cookie/contract

The frozen contract every lane builds against (docs/plan.md §5): the types, the field policy, the error codes, the HTTP endpoint list (`src/endpoints.ts`) and the interfaces of the packages the workspace calls. TypeScript callers import it, or use `@agent-cookie/sdk`, which bundles it.

## For teams not using TypeScript

`packages/contract/openapi.json` is the same contract as an OpenAPI 3.1 document: every workspace route, its request body, query parameters, responses and error codes, and a JSON Schema for every type they use. It is generated, never edited by hand: `scripts/openapi.ts` reads `ENDPOINTS` (each route's `request`, `query`, `response` and `responses`) and derives the schemas from the TypeScript types with `ts-json-schema-generator`. `test/openapi.test.ts` regenerates it in memory, so `pnpm test` fails when the committed file is stale, and validates it as OpenAPI 3.1.

Regenerate after any change to the endpoints or the types they name (Node 22.7 or later):

```sh
pnpm --filter @agent-cookie/contract openapi
```

How to read it:

- **Keys.** `Authorization: Bearer <key>`, the key `POST /agents/register` returned (shown once) or the owner key. Each operation says which key roles it accepts (`x-agent-cookie-caller` plus `x-agent-cookie-also`); an assistant's key works on the intent routes only while its owner-approved link holds.
- **Server.** `http://127.0.0.1:4310`, the local workspace, which listens on loopback only. A hosted jar is an https origin: point your client at its URL instead.
- **Errors.** Every error is `ErrorBody { error: { code, message } }`, with the HTTP status of its `ErrorCode` (the table is in the `ErrorCode` schema). Each operation lists the codes each status can carry (`x-agent-cookie-error-codes`); `default` covers the rest, including 500.
- **Open objects.** A later contract version may add optional properties. Ignore the ones you do not know.
- **Money.** Prices are integer cents of USD (`11995` is $119.95).
- **Quotes as they arrive.** `GET /personal/intents/{id}/events` is a `text/event-stream` of `IntentEvent` frames. Generated clients usually cannot stream it: read it with an SSE library, resuming with `Last-Event-ID`, or long-poll `GET /personal/intents/{id}/quotes?wait=20000` instead.

### Example: a Python client

Generate a client with [openapi-generator](https://openapi-generator.tech) (needs Java 11 or later; the `openapitools/openapi-generator-cli` Docker image takes the same arguments):

```sh
npx @openapitools/openapi-generator-cli generate \
  -i packages/contract/openapi.json \
  -g python \
  -o clients/python \
  --additional-properties=packageName=agent_cookie_client,projectName=agent-cookie-client
```

Operations are grouped by tag (`AssistantApi`, `AgentApi`, `PersonalApi`, `OwnerApi`, …), and method names follow the operation ids (`getAssistantContext` becomes `get_assistant_context`):

```python
import os
import agent_cookie_client as ac

config = ac.Configuration(host=os.environ.get("AGENT_COOKIE_URL", "http://127.0.0.1:4310"),
                          access_token=os.environ["AGENT_COOKIE_KEY"])
with ac.ApiClient(config) as client:
    context = ac.AssistantApi(client).get_assistant_context()
    print(context.fields, context.unknown)
```

### Example: the assistant link flow with curl

A company assistant registers, asks the owner for a consent link, and reads the user's context once the owner approves. Keep keys in environment variables, never in chat, logs or commits.

```sh
JAR=${AGENT_COOKIE_URL:-http://127.0.0.1:4310}

# 1. Register the assistant. No key needed. → 201 Registration { agentId, key, category, role }; the key is shown once.
curl -s -X POST "$JAR/agents/register" \
  -H 'content-type: application/json' \
  -d '{"name":"Muse","category":"assistant"}'
export ASSISTANT_KEY=...   # the "key" from the response

# 2. Ask for a consent link. → 201 LinkView { id, status: "pending", url, expiresAt }
#    (200 with the same link while one is still pending).
curl -s -X POST "$JAR/assistant/link" -H "authorization: Bearer $ASSISTANT_KEY"
LINK_ID=...                # the "id" from the response

# 3. The owner approves it with the owner key (console and CLI do the same). → 200 Link { status: "approved", sessionId, ... }
#    GET /owner/links lists pending links; POST /owner/links/$LINK_ID/decline refuses one.
curl -s -X POST "$JAR/owner/links/$LINK_ID/approve" -H "authorization: Bearer $OWNER_KEY"

# 4. The assistant sees the approval, then reads what the user's policy lets it know.
curl -s "$JAR/assistant/link/$LINK_ID" -H "authorization: Bearer $ASSISTANT_KEY"   # → LinkView { status: "approved", sessionId }
curl -s "$JAR/assistant/context" -H "authorization: Bearer $ASSISTANT_KEY"         # → AssistantContext { fields, unknown, writable, ... }
```

Before step 3, `GET /assistant/context` answers `403 SCOPE_DENIED`; after the owner revokes the grant or it lapses, `403 GRANT_REVOKED` or `403 GRANT_EXPIRED`.
