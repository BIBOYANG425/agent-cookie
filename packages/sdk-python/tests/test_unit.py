"""Offline checks: the base-URL rule, fixed error messages that never carry a key, and the error-code table."""

from __future__ import annotations

import httpx
import pytest

from agent_cookie import (
    PUBLIC_MESSAGES,
    AgentCookieError,
    AssistantClient,
    WorkspaceClient,
    WorkspaceError,
    config_from_env,
    workspace_base,
)
from agent_cookie._core import _rejection
from agent_cookie_client.models.error_code import ErrorCode

KEY = "ck_secret_never_printed_123"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, "http://127.0.0.1:4310"),
        ("http://127.0.0.1:4310", "http://127.0.0.1:4310"),
        ("http://127.0.0.1:4310/", "http://127.0.0.1:4310"),
        ("http://localhost:4310", "http://localhost:4310"),
        ("http://[::1]:4310", "http://[::1]:4310"),
        ("https://jar.example", "https://jar.example"),
        ("https://jar.example:443/u/usr_abc", "https://jar.example/u/usr_abc"),
        ("http://127.0.0.1:4320/u/usr_abc", "http://127.0.0.1:4320/u/usr_abc"),
        (" HTTPS://Jar.Example/u/a.b~c-d ", "https://jar.example/u/a.b~c-d"),
    ],
)
def test_base_url_accepted(raw, expected):
    assert workspace_base(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "http://jar.example",  # http off loopback
        "http://10.0.0.5:4310",
        "ftp://127.0.0.1",
        "https://user:pw@jar.example",
        "https://jar.example/u/abc/",  # trailing slash on a prefix
        "https://jar.example/u/../owner",
        "https://jar.example/u/./x",
        "https://jar.example/u/a%2Fb",
        "https://jar.example?x=1",
        "https://jar.example#frag",
        "https://jar.example/u/a b",
        "https://jar.example\\u",
        "https://",
        "jar.example",
        "https://jar.example:notaport",
        "",
    ],
)
def test_base_url_refused(raw):
    with pytest.raises(ValueError) as refused:
        workspace_base(raw)
    assert len(raw) < 10 or raw not in str(refused.value)


def test_client_refuses_bad_url_before_any_request():
    with pytest.raises(ValueError) as refused:
        AssistantClient("http://jar.example", KEY)
    assert KEY not in str(refused.value)


def test_config_from_env():
    cfg = config_from_env({"AGENT_COOKIE_KEY": KEY, "AGENT_COOKIE_URL": "https://jar.example/u/usr_abc"})
    assert cfg == {"base_url": "https://jar.example/u/usr_abc", "key": KEY, "sample": False}
    assert config_from_env({"AGENT_COOKIE_KEY": KEY, "AGENT_COOKIE_SAMPLE": "1"})["base_url"] == "http://127.0.0.1:4310"
    for bad in ({}, {"AGENT_COOKIE_KEY": "has space"}, {"AGENT_COOKIE_KEY": KEY, "AGENT_COOKIE_SAMPLE": "yes"},
                {"AGENT_COOKIE_KEY": KEY, "AGENT_COOKIE_URL": "http://jar.example"}):
        with pytest.raises(ValueError) as refused:
            config_from_env(bad)
        assert KEY not in str(refused.value)


def test_message_table_covers_every_contract_code():
    assert set(PUBLIC_MESSAGES) == {c.value for c in ErrorCode}


def test_error_messages_are_fixed_and_never_carry_key_or_values():
    payload = {"error": {"code": "SCOPE_DENIED", "message": f"upstream said {KEY} shipping_address=1 Example Lane"}}
    err = _rejection(403, payload)
    assert isinstance(err, WorkspaceError) and (err.status, err.code) == (403, "SCOPE_DENIED")
    assert str(err) == PUBLIC_MESSAGES["SCOPE_DENIED"]
    for text in (str(err), repr(err)):
        assert KEY not in text and "Example Lane" not in text
    unknown = _rejection(418, {"error": {"code": "TEAPOT", "message": KEY}})
    assert type(unknown) is AgentCookieError and KEY not in str(unknown)


def _client_with(handler) -> WorkspaceClient:
    client = WorkspaceClient("http://127.0.0.1:9", KEY)
    transport = client._t
    transport._http = httpx.Client(base_url=transport.base_url, transport=httpx.MockTransport(handler),
                                   headers=transport._http.headers, follow_redirects=False)
    transport._client.set_httpx_client(transport._http)
    return client


def test_requests_carry_bearer_and_idempotency_and_refuse_redirects():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/personal/intents":
            return httpx.Response(201, json={"intentId": "int_1", "expiresAt": "2026-10-18T00:30:00.000Z", "introduced": 0})
        return httpx.Response(302, headers={"Location": "https://elsewhere.example/steal"})

    client = _client_with(handler)
    created = client.create_intent("Sample · trail shoes", "idem-0001", kind="trail_shoes")
    assert created.intent_id == "int_1"
    assert seen[0].headers["Authorization"] == f"Bearer {KEY}"
    assert seen[0].headers["Idempotency-Key"] == "idem-0001"
    with pytest.raises(AgentCookieError) as redirected:
        client.get_my_card()
    assert str(redirected.value) == "Redirect refused." and len(seen) == 2
    assert KEY not in repr(client)


def test_workspace_error_from_wire_and_network_failure_messages():
    def denied(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": {"code": "PURPOSE_MISMATCH", "message": f"leak {KEY}"}})

    with pytest.raises(WorkspaceError) as err:
        _client_with(denied).get_receipts()
    assert err.value.code == "PURPOSE_MISMATCH" and KEY not in str(err.value)

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot connect {KEY}")

    with pytest.raises(AgentCookieError) as failed:
        _client_with(down).get_receipts()
    assert KEY not in str(failed.value) and failed.value.__cause__ is None


def test_invalid_input_refused_without_echo():
    client = WorkspaceClient("http://127.0.0.1:9", KEY)
    for call in (lambda: client.create_intent("", "k"), lambda: client.create_intent("x", "bad key"),
                 lambda: client.create_intent("x", "k", kind="Shoes!"), lambda: client.approve_link("..")):
        with pytest.raises(ValueError) as refused:
            call()
        assert KEY not in str(refused.value) and "Shoes!" not in str(refused.value)
