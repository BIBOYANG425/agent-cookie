"""AssistantClient, MerchantClient and WorkspaceClient: the TypeScript SDK's method names in snake_case, over the
generated client. Every method returns the generated model for its response (``agent_cookie_client.models``), with
``additional_properties["sample"] = True`` when the answer is Sample data (see ``is_sample``)."""

from __future__ import annotations

import re
import time
from collections.abc import Mapping, Sequence
from typing import Any

from agent_cookie_client.api.agent import (
    get_agent_fields,
    get_agent_handshake,
    get_agent_notes,
    get_agent_stats,
    post_agent_contributions,
    post_agent_quotes,
    put_agent_notes,
)
from agent_cookie_client.api.agents import post_agents_register
from agent_cookie_client.api.assistant import (
    get_assistant_context,
    get_assistant_link,
    get_assistant_stats,
    post_assistant_contributions,
    post_assistant_link,
)
from agent_cookie_client.api.demo import post_demo_reset
from agent_cookie_client.api.me import get_me
from agent_cookie_client.api.owner import (
    get_owner_keys,
    get_owner_links,
    post_owner_keys,
    post_owner_keys_revoke,
    post_owner_links_approve,
    post_owner_links_decline,
)
from agent_cookie_client.api.personal import (
    get_personal_card,
    get_personal_grants,
    get_personal_intents_quotes,
    get_personal_policy,
    get_personal_receipts,
    post_personal_contributions,
    post_personal_grants_revoke,
    post_personal_intents,
    post_personal_quotes_accept,
)
from agent_cookie_client.models import (
    AcceptResult,
    AssistantContext,
    AssistantContributionRequest,
    AssistantStats,
    Card,
    Contribution,
    ContributionResult,
    CreateIntentResult,
    FieldsResponse,
    GrantsResponse,
    Handshake,
    IntentRequest,
    KeysResponse,
    Link,
    LinksResponse,
    LinkView,
    MerchantContributionRequest,
    MerchantStats,
    Me,
    MintKeyRequest,
    MintKeyResult,
    NoteInfo,
    NoteView,
    PersonalContributionRequest,
    PolicyView,
    Quote,
    QuotesResponse,
    ReceiptsResponse,
    RegisterRequest,
    Registration,
    ResetResult,
    RevokeGrantResult,
    RevokeKeyResult,
    SubmitQuoteRequest,
    WriteNoteRequest,
)
from agent_cookie_client.models.field import Field

from ._core import DEFAULT_TIMEOUT_S, AgentCookieError, Transport, idempotency_key, resource_id, text

#: QUOTE_POLL_MAX_MS: how long find() waits for quotes, and the longest single long-poll.
QUOTE_POLL_MAX_MS = 20_000
#: LINK_TTL_MS: a consent link's life.
LINK_TTL_S = 600.0

_KIND = re.compile(r"[a-z][a-z0-9_]{0,63}")
_NOTE_KEY = re.compile(r"[A-Za-z0-9_.-]{1,64}")
_FIELD_NAMES = frozenset(f.value for f in Field)


def _field(name: object) -> Field:
    if not isinstance(name, str) or name not in _FIELD_NAMES:
        raise ValueError("Invalid field names.")
    return Field(name)


def _session(session_id: object) -> str:
    if not isinstance(session_id, str) or not session_id or len(session_id) > 256 or re.search(r"[\x00-\x1f\x7f]", session_id):
        raise ValueError("Invalid session ID.")
    return session_id


def _note_key(key: object) -> str:
    if not isinstance(key, str) or not _NOTE_KEY.fullmatch(key) or key in (".", ".."):
        raise ValueError("Invalid note key.")
    return key


class _Base:
    """Shared constructor: ``base_url`` (the URL rule in ``workspace_base``), ``key`` (a bearer key, never logged),
    ``sample`` (label every answer Sample) and ``timeout`` (seconds per request, default 25)."""

    def __init__(self, base_url: str, key: str, *, sample: bool = False, timeout: float = DEFAULT_TIMEOUT_S) -> None:
        self._t = Transport(base_url, key, sample=sample, timeout=timeout)

    @property
    def base_url(self) -> str:
        return self._t.base_url

    def __repr__(self) -> str:  # never the key
        return f"{type(self).__name__}(base_url={self._t.base_url!r})"

    def close(self) -> None:
        self._t.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def get_me(self) -> Me:
        """GET /me: which agent and role the presented key belongs to."""
        return self._t.call(get_me)


class _Acting(_Base):
    """The intent routes a personal agent and a linked assistant both call (the workspace scopes them to the caller)."""

    def create_intent(
        self,
        text_: str,
        idempotency_key_: str,
        *,
        query: str | None = None,
        public: Mapping[str, str] | None = None,
        kind: str | None = None,
    ) -> CreateIntentResult:
        """POST /personal/intents with an Idempotency-Key (reuse it to retry safely). ``text_`` is the person's own
        words, verbatim; ``kind`` (``[a-z][a-z0-9_]{0,63}``) also introduces stores registered with that capability."""
        if (
            not text(text_, 1000)
            or (query is not None and not text(query, 200))
            or (kind is not None and (not isinstance(kind, str) or not _KIND.fullmatch(kind)))
            or (
                public is not None
                and (
                    not isinstance(public, Mapping)
                    or len(public) > 20
                    or any(
                        not isinstance(k, str) or not k or len(k) > 64 or k in ("__proto__", "prototype", "constructor")
                        or not isinstance(v, str) or len(v.encode("utf-8")) > 256
                        for k, v in public.items()
                    )
                )
            )
        ):
            raise ValueError("Invalid shopping intent.")
        body: dict[str, Any] = {"text": text_}
        if query is not None:
            body["query"] = query
        if public is not None:
            body["public"] = dict(public)
        if kind is not None:
            body["kind"] = kind
        return self._t.call(
            post_personal_intents, body=IntentRequest.from_dict(body), idempotency_key=idempotency_key(idempotency_key_)
        )

    def get_quotes(self, intent_id: str, *, wait_ms: int = QUOTE_POLL_MAX_MS) -> QuotesResponse:
        """GET /personal/intents/{id}/quotes?wait=: long-poll until every introduced store quoted (``complete``) or
        ``wait_ms`` (at most 20000) passed."""
        if not isinstance(wait_ms, int) or isinstance(wait_ms, bool) or not 0 <= wait_ms <= QUOTE_POLL_MAX_MS:
            raise ValueError("wait_ms must be between 0 and 20000.")
        return self._t.call(get_personal_intents_quotes, resource_id(intent_id), wait=wait_ms)

    def find(
        self,
        text_: str,
        idempotency_key_: str,
        *,
        query: str | None = None,
        public: Mapping[str, str] | None = None,
        kind: str | None = None,
    ) -> QuotesResponse:
        """Create the intent, then long-poll its quotes until ``complete`` or about 20 s, whichever comes first.
        Returns the last QuotesResponse (``intent_id``, ``quotes``, ``complete``). No server-sent events."""
        created = self.create_intent(text_, idempotency_key_, query=query, public=public, kind=kind)
        deadline = time.monotonic() + QUOTE_POLL_MAX_MS / 1000
        while True:
            remaining = max(0, int((deadline - time.monotonic()) * 1000))
            quotes = self.get_quotes(created.intent_id, wait_ms=remaining)
            if quotes.complete or remaining == 0 or time.monotonic() >= deadline:
                if self._t.sample or "sample" in created.additional_properties:
                    quotes.additional_properties["sample"] = True
                return quotes

    def accept(self, quote_id: str, idempotency_key_: str) -> AcceptResult:
        """POST /personal/quotes/{id}/accept with an Idempotency-Key. ``status``: ordered | handoff (the person pays at
        ``continue_url``; not an order) | blocked | failed. Tell the person which, and pass ``message`` on verbatim."""
        result = self._t.call(post_personal_quotes_accept, resource_id(quote_id), idempotency_key=idempotency_key(idempotency_key_))
        if result.quote_id != quote_id:
            raise AgentCookieError("Invalid checkout response.")
        return result


class LinkNotApprovedError(AgentCookieError):
    """wait_for_link's error when the owner did not approve: ``reason`` is declined, expired or timeout; ``link`` the
    last LinkView."""

    _MESSAGES = {
        "declined": "The owner declined the link.",
        "expired": "The link expired before the owner decided.",
        "timeout": "The owner has not decided yet; waiting timed out.",
    }

    def __init__(self, reason: str, link: LinkView) -> None:
        super().__init__(self._MESSAGES[reason])
        self.reason = reason
        self.link = link


class AssistantClient(_Acting):
    """A company assistant (key from ``register_agent(..., category="assistant")``). Until the owner approves a link,
    ``context`` and the intent methods raise WorkspaceError 403 SCOPE_DENIED; once revoked or lapsed, GRANT_REVOKED or
    GRANT_EXPIRED. The address and the payment method never reach an assistant."""

    def request_link(self) -> LinkView:
        """POST /assistant/link: ask the owner for a session. Show ``url`` to the person; a second call while one is
        pending returns the same link."""
        return self._t.call(post_assistant_link)

    def link(self, link_id: str) -> LinkView:
        """GET /assistant/link/{id}: this assistant's own link; ``session_id`` once approved."""
        view = self._t.call(get_assistant_link, resource_id(link_id))
        if view.id != link_id:
            raise AgentCookieError("Invalid link response.")
        return view

    def wait_for_link(self, link_id: str, *, interval_s: float = 2.0, timeout_s: float = LINK_TTL_S) -> LinkView:
        """Poll ``link`` until the owner approves (returns the approved LinkView) or raise LinkNotApprovedError
        (declined, expired, timeout). A failed poll raises that call's error; calling again resumes."""
        if not 0.1 <= interval_s <= 60 or not 0 < timeout_s <= 3600:
            raise ValueError("interval_s must be 0.1–60 and timeout_s 0–3600 seconds.")
        deadline = time.monotonic() + timeout_s
        while True:
            view = self.link(link_id)
            status = str(view.status)
            if status == "approved":
                return view
            if status in ("declined", "expired"):
                raise LinkNotApprovedError(status, view)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise LinkNotApprovedError("timeout", view)
            time.sleep(min(interval_s, remaining))

    def context(self) -> AssistantContext:
        """GET /assistant/context: ``fields`` (values the policy lets this assistant know), ``unknown`` (fields it may
        ask for when the task needs them) and ``writable``. Writes an "assist" receipt the owner sees."""
        return self._t.call(get_assistant_context)

    def remember(
        self,
        field: str,
        value: str,
        *,
        basis: str | None = None,
        evidence: Mapping[str, str] | None = None,
    ) -> ContributionResult:
        """POST /assistant/contributions. ``basis``: "stated" (needs ``evidence={"conversationId", "snippet"}``, the
        person's own words, at most 200 characters), "observed" (the workspace default) or "inferred"."""
        body: dict[str, Any] = {"field": _field(field).value, "value": value}
        if not text(value, 512) or (basis is not None and basis not in ("stated", "observed", "inferred")):
            raise ValueError("Invalid contribution.")
        if basis is not None:
            body["basis"] = basis
        if evidence is not None:
            conversation = evidence.get("conversationId", evidence.get("conversation_id")) if isinstance(evidence, Mapping) else None
            snippet = evidence.get("snippet") if isinstance(evidence, Mapping) else None
            if not text(conversation, 128) or not isinstance(snippet, str) or not snippet.strip() or len(snippet) > 200:
                raise ValueError("Invalid contribution.")
            body["evidence"] = {"conversationId": conversation, "snippet": snippet}
        return self._t.call(post_assistant_contributions, body=AssistantContributionRequest.from_dict(body))

    def stats(self) -> AssistantStats:
        """GET /assistant/stats: counts over the intents this assistant created (``intents``, ``quoted``,
        ``accepted``, ``completed``, ``questions_skipped``)."""
        return self._t.call(get_assistant_stats)


class MerchantClient(_Base):
    """A store's agent (merchant key). Session ids are pairwise and come with the ``introduce`` callback."""

    def handshake(self, session_id: str) -> Handshake:
        """GET /agent/handshake: lang, tone, length and the NAMES of the fields this store may read."""
        return self._t.call(get_agent_handshake, session_id=_session(session_id))

    def fields(self, session_id: str, names: Sequence[str], purpose: str | None = None) -> FieldsResponse:
        """GET /agent/fields, all or nothing. Auto fields need no purpose; ``shipping_address`` with purpose
        "checkout" only after the person accepted this store's quote. ``payment_method`` is always SCOPE_DENIED."""
        if isinstance(names, str) or not 1 <= len(names) <= 32:
            raise ValueError("Invalid field names.")
        if purpose is not None and (not isinstance(purpose, str) or not purpose or len(purpose) > 64):
            raise ValueError("Invalid purpose.")
        kwargs: dict[str, Any] = {"session_id": _session(session_id), "fields": [_field(n) for n in names]}
        if purpose is not None:
            kwargs["purpose"] = purpose
        return self._t.call(get_agent_fields, query_lists={"fields": ","}, **kwargs)

    def quote(
        self,
        intent_id: str,
        text_: str,
        price: int,
        idempotency_key_: str,
        *,
        eta_date: str | None = None,
        eta_text: str | None = None,
        title: str | None = None,
        checkout_url: str | None = None,
    ) -> Quote:
        """POST /agent/quotes with an Idempotency-Key. ``price`` in integer cents of USD; ``eta_date`` (YYYY-MM-DD)
        only when the store commits to one."""
        if (
            not text(intent_id, 64)
            or not text(text_, 1000)
            or not isinstance(price, int) or isinstance(price, bool) or price < 0
            or (eta_date is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(eta_date)))
            or (eta_text is not None and not text(eta_text, 200))
            or (title is not None and not text(title, 200))
            or (checkout_url is not None and not text(checkout_url, 2000))
        ):
            raise ValueError("Invalid quote.")
        body: dict[str, Any] = {"intentId": intent_id, "text": text_, "price": price, "currency": "USD"}
        for k, v in (("etaDate", eta_date), ("etaText", eta_text), ("title", title), ("checkoutUrl", checkout_url)):
            if v is not None:
                body[k] = v
        return self._t.call(post_agent_quotes, body=SubmitQuoteRequest.from_dict(body), idempotency_key=idempotency_key(idempotency_key_))

    def contribute(self, field: str, value: str, basis: str = "observed", *, session_id: str | None = None) -> ContributionResult:
        """POST /agent/contributions: a fact the store observed. Anything it may not write is kept "inferred"."""
        if not isinstance(field, str) or not re.fullmatch(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?", field) or len(field) > 64 \
                or not text(value, 512) or basis not in ("stated", "observed", "inferred"):
            raise ValueError("Invalid contribution.")
        body: dict[str, Any] = {"field": field, "value": value, "basis": basis}
        if session_id is not None:
            body["sessionId"] = _session(session_id)
        return self._t.call(post_agent_contributions, body=MerchantContributionRequest.from_dict(body))

    def get_note(self, session_id: str, key: str) -> NoteView:
        """GET /agent/notes/{key}: this store's own note for the session; missing or expired → NOT_FOUND."""
        return self._t.call(get_agent_notes, _note_key(key), session_id=_session(session_id))

    def set_note(self, session_id: str, key: str, value: str) -> NoteInfo:
        """PUT /agent/notes/{key}: write this store's own note (at most 2048 UTF-8 bytes; never a card number)."""
        if not isinstance(value, str) or len(value.encode("utf-8")) > 2048:
            raise ValueError("Invalid note value.")
        return self._t.call(put_agent_notes, _note_key(key), body=WriteNoteRequest(value=value), session_id=_session(session_id))

    def stats(self) -> MerchantStats:
        """GET /agent/stats: counts over this store's own sessions only."""
        return self._t.call(get_agent_stats)


class WorkspaceClient(_Acting):
    """The person's own agent (personal key: reads the whole card) and the owner's console or CLI (owner key)."""

    def get_my_card(self) -> Card:
        """GET /personal/card: the card with provenance."""
        return self._t.call(get_personal_card)

    def get_receipts(self, *, limit: int | None = None) -> ReceiptsResponse:
        """GET /personal/receipts, newest first: who read which field, for which purpose; never values."""
        return self._t.call(get_personal_receipts, **({"limit": limit} if limit is not None else {}))

    def remember(self, field: str, value: str) -> Contribution:
        """POST /personal/contributions: one fact the person stated (stored with basis "stated")."""
        if not text(value, 512):
            raise ValueError("Invalid contribution.")
        return self._t.call(post_personal_contributions, body=PersonalContributionRequest(field=_field(field), value=value))

    def get_grants(self) -> GrantsResponse:
        """GET /personal/grants."""
        return self._t.call(get_personal_grants)

    def revoke_grant(self, grant_id: str) -> RevokeGrantResult:
        """POST /personal/grants/{id}/revoke: stops future reads; does not recall what was released."""
        return self._t.call(post_personal_grants_revoke, resource_id(grant_id))

    def get_policy(self) -> PolicyView:
        """GET /personal/policy: the installed field-policy document, its id and source."""
        return self._t.call(get_personal_policy)

    # ---- owner key ----

    def list_links(self, *, limit: int | None = None) -> LinksResponse:
        """Owner key. GET /owner/links, newest first (``limit`` 1–500)."""
        if limit is not None and (not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 500):
            raise ValueError("Invalid links query.")
        return self._t.call(get_owner_links, **({"limit": limit} if limit is not None else {}))

    def approve_link(self, link_id: str) -> Link:
        """Owner key. The owner's consent: creates the assistant's pairwise session and grant. LINK_NOT_PENDING once
        decided or expired. Explicit action only; never retried."""
        return self._t.call(post_owner_links_approve, resource_id(link_id))

    def decline_link(self, link_id: str) -> Link:
        """Owner key. The assistant sees ``declined``."""
        return self._t.call(post_owner_links_decline, resource_id(link_id))

    def mint_key(self, agent_id: str, role: str, label: str) -> MintKeyResult:
        """Owner key. POST /owner/keys: a key for one of the person's own agents (role "personal") or a store added by
        hand (role "merchant"). The key is in the result ONCE: store it as a secret, never log or print it."""
        if not isinstance(agent_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{0,63}", agent_id) \
                or role not in ("personal", "merchant") or not text(label, 200):
            raise ValueError("Invalid key request.")
        return self._t.call(post_owner_keys, body=MintKeyRequest.from_dict({"agentId": agent_id, "role": role, "label": label}))

    def list_keys(self) -> KeysResponse:
        """Owner key. GET /owner/keys: the keys the owner minted (agent, role, label, dates); never a key."""
        return self._t.call(get_owner_keys)

    def revoke_key(self, agent_id: str) -> RevokeKeyResult:
        """Owner key. POST /owner/keys/{agentId}/revoke: every live key of that agent answers 401 from then on."""
        return self._t.call(post_owner_keys_revoke, resource_id(agent_id))

    def demo_reset(self) -> ResetResult:
        """Owner key, AGENT_COOKIE_DEMO=1 only. Explicit action; never retried."""
        return self._t.call(post_demo_reset)


def register_agent(
    url: str,
    name: str,
    category: str,
    *,
    capabilities: Sequence[str] | None = None,
    callback_url: str | None = None,
    chat_endpoint: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_S,
) -> Registration:
    """POST /agents/register, no key: creates an agent and returns its key ONCE (``Registration.key``). Keep it in
    your secret store (AGENT_COOKIE_KEY), never in a prompt, chat, log or commit. Category "personal" needs the owner
    key and is refused here; an assistant takes no callback or chat endpoint."""
    if (
        not text(name, 200)
        or not isinstance(category, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", category)
        or (capabilities is not None and (isinstance(capabilities, str) or len(capabilities) > 20
            or not all(isinstance(c, str) and 0 < len(c) <= 64 for c in capabilities)))
        or (callback_url is not None and not text(callback_url, 2000))
        or (chat_endpoint is not None and not text(chat_endpoint, 2000))
    ):
        raise ValueError("Invalid registration.")
    body: dict[str, Any] = {"name": name, "category": category}
    if capabilities is not None:
        body["capabilities"] = list(capabilities)
    if callback_url is not None:
        body["callbackUrl"] = callback_url
    if chat_endpoint is not None:
        body["chatEndpoint"] = chat_endpoint
    try:
        request = RegisterRequest.from_dict(body)
    except ValueError:
        raise ValueError("Invalid registration.") from None
    transport = Transport(url, None, timeout=timeout)
    try:
        return transport.call(post_agents_register, body=request)
    finally:
        transport.close()
