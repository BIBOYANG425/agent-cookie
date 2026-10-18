# agent-cookie (Python)

The Python SDK for the Agent Cookie workspace, with the same three clients as `@agent-cookie/sdk` and the TypeScript method names in snake_case: `AssistantClient` for a personal-assistant company (it registers with `category="assistant"` and is linked once through a consent link the person approves), `MerchantClient` for a store's agent (`category="retail"` or `"shoe"`), and `WorkspaceClient` for the person's own agent, or the owner's console with the owner key.

It has two layers:

- `agent_cookie_client/` is **generated** from `packages/contract/openapi.json` by [openapi-python-client](https://github.com/openapi-generators/openapi-python-client) 0.29.1. It is committed and never edited by hand.
- `agent_cookie/` is **hand-written** and thin: configuration, the base-URL rule, typed errors, idempotency keys, Sample labels and the polling helpers (`find`, `wait_for_link`). Requests are built by the generated operations and parsed into the generated models.

Python 3.11 or later: the generated code uses `enum.StrEnum` and `typing.Self`. Runtime dependencies: `httpx` and `attrs`.

## Setup, regeneration, tests

```sh
pnpm --filter @agent-cookie/sdk-python run bootstrap     # once: .venv with the pinned generator, ruff, pytest, and this package (editable)
pnpm --filter @agent-cookie/sdk-python run generate  # after the contract's openapi.json changes
pnpm --filter @agent-cookie/sdk-python test          # pytest: offline unit tests plus a REAL demo workspace
```

The script is named `bootstrap` because `pnpm setup` is a pnpm built-in. It is idempotent: it does nothing unless `requirements-dev.txt` or `pyproject.toml` changed. `test` runs setup itself when `.venv` is missing. Without `python3` it prints `skipped: python3 not found` and exits 0, so `pnpm -r test` still passes on a machine with no Python.

`generate` writes `agent_cookie_client/` from `openapi-python-client.yaml` and formats it with the pinned ruff. Running it twice gives no diff. The integration tests (`tests/test_*_flow.py`) start `apps/workspace` with `tsx src/server.ts` in demo mode, the same way `apps/workspace/test/acceptance/helpers.ts` does (`AGENT_COOKIE_DEMO=1 AGENT_COOKIE_UCP=fixture`, in-memory SQLite, the Sample seed in `fixtures/`, a temp memory repo). They read the keys from `fixtures/dev-keys.json` and never print them. If `pnpm install` has not been run, they are skipped.

### What the generator could not do

All 49 operations in `openapi.json` were generated, the `/owner/keys` routes included, and the generator printed no warnings. Two operations do not work through the generated layer as it stands, and the wrappers handle both:

- **`GET /personal/intents/{id}/events`** (server-sent events). The generated function treats the `text/event-stream` body as one JSON object, so it cannot read the stream. This SDK does not stream: `find` long-polls `GET /personal/intents/{id}/quotes?wait=` instead. For live events, use an SSE library and resume with `Last-Event-ID`.
- **`GET /agent/fields`**. The contract sends `fields` as one comma-separated value (`style: form, explode: false`), but the generator sends a repeated parameter (`fields=a&fields=b`). `MerchantClient.fields` joins the names with `,` before sending.

Open objects work as the contract describes them. Every generated model keeps properties it does not know in `additional_properties`.

## Quickstart (a): an assistant company

```python
from agent_cookie import AssistantClient, register_agent

url = "http://127.0.0.1:4310"
# Once, at setup. The key is shown once: store it as a secret, never in chat or logs.
reg = register_agent(url, "Muse", "assistant")
muse = AssistantClient(url, reg.key)

# Ask the person once. They approve in their console, CLI or gateway; nothing approves automatically.
link = muse.request_link()
print(f"Continue with Agent Cookie: {link.url}")  # show this to the person
muse.wait_for_link(link.id)  # raises LinkNotApprovedError: declined | expired | timeout

# Every conversation: what they already told their agents.
ctx = muse.context()
known = ctx.fields.to_dict()  # e.g. {"lang": "zh", "shoe_size": "42"}; ctx.unknown: fields to ask only when needed

# Acting for them: the workspace introduces stores and gives the store the address at checkout, not you.
found = muse.find("trail running shoes under $150, size 42", "find-0001", kind="shoes")
result = muse.accept(found.quotes[0].id, "accept-0001")  # the quote the person chose
# result.status: ordered | handoff (they pay at result.continue_url) | blocked | failed. Tell them which.

muse.remember("pref.brand", "Brooks", basis="stated",
              evidence={"conversationId": "chat-8812", "snippet": "I only run in Brooks"})
stats = muse.stats()  # intents, quoted, accepted, completed, questions_skipped: counts only
```

Until the link is approved, `context()` and the intent methods raise `WorkspaceError` 403 `SCOPE_DENIED`. After the owner revokes the grant, they raise `GRANT_REVOKED`, and after it lapses, `GRANT_EXPIRED`. An assistant never receives `shipping_address` or `payment_method`. A `stated` fact without `evidence` is refused with 422 `MISSING_FIELD`.

## Quickstart (b): a commerce agent

```python
from agent_cookie import MerchantClient, is_workspace_error, register_agent

url = "http://127.0.0.1:4310"
reg = register_agent(url, "Trail Store", "retail", capabilities=["shoes"],
                     callback_url="http://127.0.0.1:5001/agent-cookie")  # the workspace POSTs introduce / accepted here
store = MerchantClient(url, reg.key)

# On `introduce` ({ sessionId, intent }): greet in their language and know their size. Ask nothing.
hello = store.handshake(session_id)  # lang, tone, length and the NAMES of readable fields
fields = store.fields(session_id, ["shoe_size", "pref.brand"]).fields.to_dict()  # auto fields, no purpose
store.quote(intent_id, "Trail shoe, EU 42", 11995, f"quote-{intent_id}")  # integer cents of USD

# On `accepted`: the address is released for checkout, and the person gets a receipt.
ship = store.fields(session_id, ["shipping_address"], "checkout").fields.to_dict()

# payment_method never reaches a store, whatever it asks: the workspace authorizes payment itself.
try:
    store.fields(session_id, ["payment_method"], "payment")
except Exception as error:
    if not is_workspace_error(error, "SCOPE_DENIED"):
        raise  # refused, as designed
store.contribute("shoe_size", "42", "observed", session_id=session_id)
store.set_note(session_id, "fit", "prefers a wide toe box")  # your own note, at most 2 KB
stats = store.stats()  # your own sessions only, counts only
```

## Quickstart (c): the person's own agent

```python
from agent_cookie import WorkspaceClient, config_from_env

# AGENT_COOKIE_KEY: a personal key the owner minted; AGENT_COOKIE_URL defaults to http://127.0.0.1:4310.
me = WorkspaceClient(**config_from_env())
assert str(me.get_me().role) == "personal"
card = me.get_my_card()  # the whole card with provenance: the person's own agent may see it

found = me.find("a black coat, size M, under $150", "find-0002")
result = me.accept(found.quotes[0].id, f"accept-{found.quotes[0].id}")
receipts = me.get_receipts().receipts  # who read which field, for which purpose; never values
me.remember("pref.color", "teal")  # something the person stated, stored as "stated"
```

The owner key (console, CLI) also decides consent links and manages keys: `list_links(limit=)`, `approve_link(id)`, `decline_link(id)`, `mint_key(agent_id, role, label)` (the key is in the result **once**), `list_keys()` (never a key) and `revoke_key(agent_id)`.

## Reference

**Return values.** Each method returns the generated model for its response, for example `AssistantContext`, `QuotesResponse`, `AcceptResult` or `Card` from `agent_cookie_client.models`, with snake_case attributes. `model.to_dict()` gives the wire JSON. The same models are documented in the contract, so this SDK does not add a second set of types.

**Sample data.** `is_sample(result)` is `True` when the answer is Sample data. The SDK sets `result.additional_properties["sample"] = True` when that happens, and `to_dict()` includes the flag. An answer is Sample when it, its card or any of its quotes has `source: sample | fixture` (demo seed or recorded fixtures), or when the client was created with `sample=True` or `AGENT_COOKIE_SAMPLE=1`. Contexts, handshakes, links and stats carry no source, so set `sample=True` to label those too. Never show Sample data as a real person, real inventory or a real order.

**Clients.** `AssistantClient(base_url, key, *, sample=False, timeout=25.0)`, and the same for `MerchantClient` and `WorkspaceClient`. Each also works as a context manager (`close()`).

- Shared by `AssistantClient` and `WorkspaceClient`: `get_me()`, `create_intent(text, idempotency_key, *, query=, public=, kind=)`, `get_quotes(intent_id, *, wait_ms=20000)`, `find(text, idempotency_key, *, query=, public=, kind=)` and `accept(quote_id, idempotency_key)`. `find` creates the intent, then long-polls until the quotes are `complete` or 20 s pass.
- `AssistantClient`: `request_link()`, `link(id)`, `wait_for_link(id, *, interval_s=2, timeout_s=600)`, `context()`, `remember(field, value, *, basis=, evidence=)` and `stats()`.
- `MerchantClient`: `handshake(session_id)`, `fields(session_id, names, purpose=None)` (all or nothing, 1 to 32 names), `quote(intent_id, text, price, idempotency_key, *, eta_date=, eta_text=, title=, checkout_url=)`, `contribute(field, value, basis="observed", *, session_id=)`, `get_note(session_id, key)`, `set_note(session_id, key, value)` and `stats()`.
- `WorkspaceClient`: `get_my_card()`, `get_receipts(limit=)`, `remember(field, value)`, `get_grants()`, `revoke_grant(id)` and `get_policy()`. With the owner key: `list_links`, `approve_link`, `decline_link`, `mint_key`, `list_keys`, `revoke_key` and `demo_reset()` (demo mode only).
- `register_agent(url, name, category, *, capabilities=, callback_url=, chat_endpoint=, timeout=)` returns a `Registration` with `agent_id`, `key`, `category` and `role`. It needs no key. Category `personal` needs the owner key and is refused.
- `config_from_env(env=os.environ)` returns `{"base_url", "key", "sample"}` from `AGENT_COOKIE_URL`, `AGENT_COOKIE_KEY` (required) and `AGENT_COOKIE_SAMPLE` (`0` or `1`).

**Where the workspace is.** These are the same rules as the TypeScript SDK, checked before any request:

- `https://` on any host, or `http://` only on loopback (`127.0.0.1`, `localhost` or `[::1]`).
- An origin, optionally followed by a path prefix of plain segments (`[A-Za-z0-9._~-]`) with no trailing slash, for example `https://gateway.example/u/usr_abc`.
- No query, fragment, credentials, escapes or dot segments.

Anything else raises `ValueError` with one fixed message. The SDK never follows a redirect: a 3xx raises `AgentCookieError("Redirect refused.")`. It accepts no cookies and never retries a request. Plain-`http` loopback requests ignore environment proxies.

**Idempotency.** `create_intent`, `find`, `accept` and `quote` take a caller-chosen idempotency key, sent as the `Idempotency-Key` header. Reuse the same key to retry safely.

## Errors

A non-2xx answer with a contract code raises `WorkspaceError`, which has `status`, `code` and a fixed public message, the same table as `packages/sdk/src/core.ts` (`PUBLIC_MESSAGES`). Anything else raises a plain `AgentCookieError`. That includes an unknown code, a network failure, a redirect and an invalid response. Its message is also fixed, and it carries no chained cause. Input that fails validation raises `ValueError` before any request is sent, and the message never repeats the input. No message ever contains a key, a field value or upstream text.

The codes are `AUTH_REQUIRED` (401); `SCOPE_DENIED`, `PURPOSE_MISMATCH`, `GRANT_EXPIRED`, `GRANT_REVOKED`, `JAR_LOCKED`, `AUTHORIZATION_USED` and `OVER_BUDGET` (403); `NOT_FOUND` (404); `IDEMPOTENCY_CONFLICT` and `LINK_NOT_PENDING` (409); `MISSING_FIELD` (422); and `UPSTREAM_ERROR` (502). They are listed in `WORKSPACE_ERROR_CODES`.

```python
from agent_cookie import is_workspace_error

try:
    muse.context()
except Exception as error:
    if is_workspace_error(error, "SCOPE_DENIED"): tell("Not allowed yet: approve the link first.")
    elif is_workspace_error(error, "GRANT_REVOKED", "GRANT_EXPIRED"): tell("Access was withdrawn; ask again.")
    else: raise
```

Keys are bearer credentials and are shown once. Keep them in your secret store (`AGENT_COOKIE_KEY`), never in a prompt, a chat message, a log or a commit. A client's `repr` shows only its base URL.

## License

MIT; see LICENSE at the repository root.
