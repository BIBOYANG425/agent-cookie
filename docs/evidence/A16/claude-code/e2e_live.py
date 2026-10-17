"""A16 live check: the generated retail Agent Cookie mode against the isolated workspace on
127.0.0.1:4320 (real HTTP). Keys stay in process memory and are never printed.

Steps: register two shoe merchants with callback URLs on a local listener, create a personal
intent with the sample personal dev key, take the pairwise session ids from the real
introduce callbacks, boot retail.api.main in Agent Cookie mode (lifespan runs GET /me),
bind a storefront session, run get_preferences / save_memory / recall_memories through the
generated executor, cross-check the note directly over workspace HTTP, then revoke and
expire grants and check every path refuses.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import httpx

WS = "http://127.0.0.1:4320"
CLONE = Path("/private/tmp/agent-cookie-a16-20261017/claude-code")
RESULTS = Path("/private/tmp/agent-cookie-a16-20261017/claude-code-results")
DEV_KEYS = RESULTS / "workspace-runtime/fixtures/dev-keys.json"
LOG = RESULTS / "live-e2e.jsonl"
CALLBACK_PORT = 8013
KIND = "a16_retail"

callbacks: dict[str, list[dict]] = {}
results: list[dict] = []


def record(step: str, ok: bool, **detail) -> None:
    entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "step": step, "ok": ok, **detail}
    results.append(entry)
    with LOG.open("a", encoding="utf-8") as out:
        out.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(("PASS " if ok else "FAIL ") + step, json.dumps(detail, ensure_ascii=False)[:400])


class Listener(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        callbacks.setdefault(self.path, []).append(body)
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *_):
        pass


def personal_key() -> str:
    keys = json.loads(DEV_KEYS.read_text())
    return next(k for k, v in keys.items() if v.get("role") == "personal" and v.get("agentId") == "sample-personal-photon")


async def wait_callback(path: str, count: int = 1, timeout: float = 10) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if len(callbacks.get(path, [])) >= count:
            return callbacks[path][count - 1]
        await asyncio.sleep(0.1)
    raise TimeoutError(path)


async def main() -> int:
    LOG.write_text("")
    server = HTTPServer(("127.0.0.1", CALLBACK_PORT), Listener)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    personal = {"Authorization": f"Bearer {personal_key()}"}
    ws = httpx.AsyncClient(base_url=WS, timeout=10)

    # 1. Two shoe merchants, each with its own key and callback.
    merchants = {}
    for name in ("a", "b"):
        r = await ws.post("/agents/register", json={
            "name": f"ACME Retail A16 {name.upper()}", "category": "shoe", "capabilities": [KIND],
            "callbackUrl": f"http://127.0.0.1:{CALLBACK_PORT}/cb/{name}"})
        reg = r.json()
        merchants[name] = {"agentId": reg.get("agentId"), "key": reg.get("key")}
        record(f"register merchant {name}", r.status_code == 201 and reg.get("role") == "merchant",
               status=r.status_code, agentId=reg.get("agentId"), category=reg.get("category"))
    key_a = {"Authorization": f"Bearer {merchants['a']['key']}"}
    key_b = {"Authorization": f"Bearer {merchants['b']['key']}"}

    # 2. A personal intent introduces both merchants; pairwise ids arrive by callback.
    r = await ws.post("/personal/intents", headers={**personal, "Idempotency-Key": str(uuid.uuid4())},
                      json={"kind": KIND, "public": {"query": "trail running shoes"}})
    record("personal intent", r.status_code == 201, status=r.status_code, body=r.json())
    intro_a, intro_b = await wait_callback("/cb/a"), await wait_callback("/cb/b")
    pw_a, pw_b = intro_a["sessionId"], intro_b["sessionId"]
    record("introduce callbacks", pw_a != pw_b, pairwise_a=pw_a, pairwise_b=pw_b,
           handshake_a_available=intro_a["handshake"]["available"])

    # 3. Boot the generated Agent Cookie mode of retail.api.main.
    os.environ.update({"AGENT_COOKIE_URL": WS, "AGENT_COOKIE_KEY": merchants["a"]["key"],
                       "AGENT_COOKIE_NOTE_KEYS": "fit_notes,gift_recipients"})
    os.environ.pop("ANTHROPIC_API_KEY", None)
    sys.path.insert(0, str(CLONE / "examples"))
    from retail.api import main as retail  # noqa: E402

    record("retail in Agent Cookie mode", retail.agent_cookie is not None and retail.agent.memory.store is None
           and not retail.agent.memory.enabled, memory_store=repr(retail.agent.memory.store))
    app = retail.app
    store = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1", timeout=30)
    async with app.router.lifespan_context(app):
        record("startup GET /me", retail.agent_cookie.category == "shoe", category=retail.agent_cookie.category)

        # 4. Binding: a foreign pairwise id is refused, A's own is accepted.
        r = await store.post("/api/agent-cookie/session", json={"session_id": pw_b})
        record("bind refuses merchant B's pairwise id", r.status_code == 404, status=r.status_code, body=r.json())
        r = await store.post("/api/agent-cookie/session", json={"session_id": pw_a})
        bound = r.json()
        record("bind storefront session", r.status_code == 200 and bound["user_id"] != "demo-user",
               status=r.status_code, user_id=bound.get("user_id"), available=bound.get("available"))
        sid = bound["session_id"]
        record_ = retail.host.sessions.require(sid)

        def tools():
            return retail.agent.executor_class(
                backend=retail.agent.backend, config=retail.agent.config, skills=retail.agent.skills,
                session=retail.host.context(record_), state=record_.state, memory=retail.agent.memory)

        # 5. Fields through the generated seam (handshake + /agent/fields, real HTTP).
        prefs = await retail.agent.backend.get_preferences(retail.host.context(record_))
        record("read authorized fields (prefetch seam)", "shoe_size" in prefs.preferences,
               preferences=prefs.preferences, label="Sample card data")
        out = await tools().execute("get_preferences", {})
        record("get_preferences tool", not out.is_error and "shoe_size" in out.result_text, is_error=out.is_error,
               result=out.result_text[:600])

        # 6. Own note: write, read back through the tool and directly over workspace HTTP.
        out = await tools().execute("save_memory", {"key": "fit_notes", "value": "prefers a roomy toe box in trail shoes", "category": "context"})
        record("save_memory -> PUT note", out.result_text == "Saved: fit_notes.", result=out.result_text)
        out = await tools().execute("recall_memories", {"topic": "toe box"})
        record("recall_memories -> GET note", "roomy toe box" in out.result_text, result=out.result_text[:600])
        r = await ws.get("/agent/notes/fit_notes", params={"sessionId": pw_a}, headers=key_a)
        record("direct GET own note (merchant A key)", r.status_code == 200 and "roomy toe box" in r.json().get("value", ""),
               status=r.status_code, body=r.json())
        r = await ws.get("/agent/notes/fit_notes", params={"sessionId": pw_a}, headers=key_b)
        record("merchant B cannot read A's note", r.status_code == 404, status=r.status_code, body=r.json())
        r = await ws.get("/agent/notes/fit_notes", params={"sessionId": pw_b}, headers=key_b)
        record("B's own session has no such note", r.status_code == 404, status=r.status_code, body=r.json())

        # 7. Refused writes never reach the workspace.
        for case in ({"key": "fit_notes", "value": "email me at someone@example.com"},
                     {"key": "shoe_size", "value": "44"}, {"key": "favourite_colour", "value": "green"}):
            out = await tools().execute("save_memory", case)
            record(f"refused write {case['key']}", out.is_error, result=out.result_text)
        r = await ws.get("/agent/notes/fit_notes", params={"sessionId": pw_a}, headers=key_a)
        record("note unchanged after refused writes", "roomy toe box" in r.json().get("value", ""), body=r.json())

        # 8. Memory operations the contract lacks.
        r = await store.get("/api/memory", headers={"X-Session-Id": sid})
        record("GET /api/memory -> 501", r.status_code == 501, status=r.status_code, body=r.json())
        r = await store.post("/api/reset", headers={"X-Session-Id": sid}, json={"purge_memory": True})
        record("purge reset -> 501", r.status_code == 501, status=r.status_code)

        # 9. Chat with a live grant passes the gate; the model then needs credentials.
        r = await store.post("/api/chat", headers={"X-Session-Id": sid}, json={"message": "Any trail shoes for me?"})
        record("chat with live grant passes gate (model unverified: no API key)", r.status_code == 200,
               status=r.status_code, body=r.text[:400])

        # 10. Revoke merchant A's grant: every path refuses, nothing falls back.
        grants = (await ws.get("/personal/grants", headers=personal)).json()["grants"]
        target = [g for g in grants if g.get("agentId") == merchants["a"]["agentId"]]
        record("grants listed", bool(target), grants=[{k: g.get(k) for k in ("id", "agentId", "fields", "purpose")} for g in target])
        for grant in target:
            r = await ws.post(f"/personal/grants/{grant['id']}/revoke", headers=personal)
            record("revoke grant", r.status_code == 200, status=r.status_code)
        r = await store.post("/api/chat", headers={"X-Session-Id": sid}, json={"message": "hello again"})
        record("chat refused before the model after revoke", r.status_code == 403 and r.json()["detail"] == "GRANT_REVOKED",
               status=r.status_code, body=r.json())
        out = await tools().execute("get_preferences", {})
        record("get_preferences after revoke is an error", out.is_error and "shoe_size" not in out.result_text, result=out.result_text)
        out = await tools().execute("save_memory", {"key": "gift_recipients", "value": "buys for a sibling"})
        record("save after revoke refused", out.is_error and "GRANT_REVOKED" in out.result_text, result=out.result_text)
        out = await tools().execute("recall_memories", {"topic": "toe"})
        record("recall after revoke refused, no stale note", out.is_error and "roomy" not in out.result_text, result=out.result_text)

        # 11. A new intent gives a new grant (re-authorization), then the clock passes its TTL.
        r = await ws.post("/personal/intents", headers={**personal, "Idempotency-Key": str(uuid.uuid4())},
                          json={"kind": KIND, "public": {"query": "road shoes"}})
        await wait_callback("/cb/a", 2)
        out = await tools().execute("recall_memories", {"topic": "toe"})
        record("new grant: note readable again (same pairwise session)", "roomy toe box" in out.result_text, result=out.result_text[:400])
        r = await ws.post("/test/clock", json={"offsetMs": 11 * 60 * 1000})
        record("test clock +11 min", r.status_code == 200, body=r.json())
        r = await store.post("/api/chat", headers={"X-Session-Id": sid}, json={"message": "still there?"})
        record("chat refused after expiry", r.status_code == 403 and r.json()["detail"] == "GRANT_EXPIRED", status=r.status_code, body=r.json())
        out = await tools().execute("save_memory", {"key": "gift_recipients", "value": "buys for a sibling"})
        record("save after expiry refused", out.is_error and "GRANT_EXPIRED" in out.result_text, result=out.result_text)
        r = await ws.post("/test/clock", json={"offsetMs": 0})
        record("test clock reset", r.status_code == 200, body=r.json())

    record("client closed at shutdown", retail.agent_cookie.client._http.is_closed)
    await store.aclose()
    await ws.aclose()
    server.shutdown()
    failed = [entry["step"] for entry in results if not entry["ok"]]
    print(json.dumps({"total": len(results), "failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
