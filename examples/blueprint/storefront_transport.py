"""Shared transport for the pinned upstream storefront, not workspace authorization.

A trusted host must authorize and bind the pairwise subject before open_session,
and recheck its workspace grant before every chat. This module does neither;
it is not an HTTP route, MemoryStore, or evidence of Agent Cookie integration.
It never retries chat POSTs or logs session tokens / model payloads.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import json
from typing import Any
from urllib.parse import urlsplit

import httpx


class StorefrontError(RuntimeError):
    """A bounded diagnostic code; no upstream body, token, or private context."""


@dataclass(frozen=True)
class StorefrontSession:
    origin: str
    subject: str = field(repr=False)
    token: str = field(repr=False)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False, compare=False)


@dataclass(frozen=True)
class StorefrontEvent:
    type: str
    data: dict[str, Any] = field(repr=False)


@dataclass(frozen=True)
class StorefrontTurn:
    events: tuple[StorefrontEvent, ...] = field(repr=False)

    @property
    def stop_reason(self) -> str | None:
        for event in reversed(self.events):
            if event.type == "turn_complete":
                reason = event.data.get("stop_reason")
                return reason if isinstance(reason, str) else None
        return None

    @property
    def is_truncated(self) -> bool:
        return self.stop_reason == "max_tokens"

    @property
    def text(self) -> str:
        return "".join(e.data["text"] for e in self.events
                       if e.type == "text_delta" and isinstance(e.data.get("text"), str))

    @property
    def has_failed_actions(self) -> bool:
        return any(e.type == "tool_result" and
                   (e.data.get("is_error") or e.data.get("status") in {"error", "blocked"})
                   for e in self.events)


class StorefrontClient:
    def __init__(self, origin: str, *, transport: httpx.AsyncBaseTransport | None = None):
        url = urlsplit(origin)
        # This scaffold only supports the two explicitly configured local stores.
        if (url.scheme != "http" or url.hostname not in {"127.0.0.1", "localhost", "::1"}
                or url.username or url.password or url.query or url.fragment
                or url.path not in {"", "/"} or not url.port):
            raise ValueError("Expected a loopback storefront origin with an explicit port")
        self.origin = origin.rstrip("/")
        self._http = httpx.AsyncClient(base_url=self.origin, timeout=60,
                                      follow_redirects=False, trust_env=False, transport=transport)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self._http.aclose()

    @staticmethod
    def _status(response: httpx.Response):
        if not 200 <= response.status_code < 300:
            raise StorefrontError(f"http_{response.status_code}")

    async def open_session(self, subject: str) -> StorefrontSession:
        if not isinstance(subject, str) or not 1 <= len(subject) <= 64:
            raise ValueError("Explicit host-bound subject of 1–64 characters required")
        try:
            response = await self._http.post("/api/session", json={"user_id": subject})
            self._status(response)
            body = response.json()
        except httpx.HTTPError:
            raise StorefrontError("transport_error") from None
        except ValueError:
            raise StorefrontError("invalid_session_response") from None
        if not isinstance(body, dict) or body.get("user_id") != subject:
            raise StorefrontError("session_subject_mismatch")
        token = body.get("session_id")
        if not isinstance(token, str) or not token:
            raise StorefrontError("invalid_session_response")
        return StorefrontSession(self.origin, subject, token)

    async def chat(self, session: StorefrontSession, message: str,
                   *, page: dict[str, Any] | None = None) -> StorefrontTurn:
        if session.origin != self.origin:
            raise StorefrontError("session_origin_mismatch")
        if not isinstance(message, str) or not 1 <= len(message) <= 4000:
            raise ValueError("Message must contain 1–4000 characters")
        body: dict[str, Any] = {"message": message}
        if page is not None:
            body["page"] = page
        try:
            # Serialize HTTP streams for this token. Upstream history write-back
            # runs after EOF; only a server-side barrier can serialize that too.
            async with session.lock, asyncio.timeout(120):
                async with self._http.stream("POST", "/api/chat", json=body, headers={
                    "X-Session-Id": session.token, "Accept": "text/event-stream",
                }) as response:
                    self._status(response)
                    if response.headers.get("content-type", "").split(";", 1)[0].strip() != "text/event-stream":
                        raise StorefrontError("invalid_content_type")
                    return await self._turn(response)
        except (httpx.HTTPError, TimeoutError):
            raise StorefrontError("transport_error") from None

    @staticmethod
    async def _turn(response: httpx.Response) -> StorefrontTurn:
        events: list[StorefrontEvent] = []
        event_type, data = "message", []
        total = 0
        complete = False
        async for line in response.aiter_lines():
            total += len(line)
            if total > 8 * 1024 * 1024 or len(events) >= 4096:
                raise StorefrontError("response_limit")
            if line == "":
                if data:
                    try:
                        payload = json.loads("\n".join(data))
                    except ValueError:
                        raise StorefrontError("invalid_sse") from None
                    if not isinstance(payload, dict):
                        raise StorefrontError("invalid_sse")
                    if event_type == "error":
                        raise StorefrontError("upstream_error")
                    events.append(StorefrontEvent(event_type, payload))
                    complete = complete or event_type == "turn_complete"
                event_type, data = "message", []
            elif not line.startswith(":"):
                name, _, value = line.partition(":")
                if value.startswith(" "):
                    value = value[1:]
                if name == "event":
                    event_type = value
                elif name == "data":
                    data.append(value)
        if data or not complete:
            raise StorefrontError("incomplete_turn")
        return StorefrontTurn(tuple(events))
