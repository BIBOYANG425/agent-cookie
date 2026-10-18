from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.create_intent_result import CreateIntentResult
from ...models.error_body import ErrorBody
from ...models.intent_request import IntentRequest
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: IntentRequest,
    idempotency_key: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(idempotency_key, Unset):
        headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/personal/intents",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> CreateIntentResult | ErrorBody:
    if response.status_code == 201:
        response_201 = CreateIntentResult.from_dict(response.json())

        return response_201

    if response.status_code == 401:
        response_401 = ErrorBody.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ErrorBody.from_dict(response.json())

        return response_403

    if response.status_code == 409:
        response_409 = ErrorBody.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = ErrorBody.from_dict(response.json())

        return response_422

    response_default = ErrorBody.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[CreateIntentResult | ErrorBody]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: IntentRequest,
    idempotency_key: str | Unset = UNSET,
) -> Response[CreateIntentResult | ErrorBody]:
    """Store intent, match merchants (registry or UCP), introduce, notify; returns intentId

    **Key role:** `personal`, `assistant`. An assistant's key works only while its owner-approved link
    (live assist grant) holds.
    Accepts `Idempotency-Key`: the same key with the same body replays the stored response; with a
    different body, 409 `IDEMPOTENCY_CONFLICT`.

    Args:
        idempotency_key (str | Unset):
        body (IntentRequest): POST /personal/intents body (2026-10-17, human direction: search is
            driven by the user's sentence; replaces the fixed trail_shoes / EU 42 / $120 / pinned-
            store demo).  - text   — the user's own words, verbatim. Required. The UCP query when
            `query` is absent; the chat message for             Tier 0 merchants. Never sent in
            introduce callbacks.  - query  — what to search for, when the personal agent extracted it
            (e.g. English keywords for UCP).  - public — conditions the user stated in THIS request;
            sent to introduced merchants. Known keys:      budget   USD, "120" / "$120" / "100-160"
            (upper bound). HARD: offers above it are dropped.      size     e.g. "42", "US 9". SOFT:
            ranks matching variants first; never excludes. A quote whose variant does
            not match carries `sizeNote` ("没有 42，有 41、43"). `shoe_size` is accepted as an alias.
            count    how many different sellers to quote, 1–5 (default 2).      color, deadline, …
            other public conditions, passed through.    Not stated → the card's budget / shoe_size are
            used to RANK only, never to exclude.  - kind   — optional hint, not an enum: registered
            merchants listing it in `capabilities` are introduced too.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateIntentResult | ErrorBody]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: IntentRequest,
    idempotency_key: str | Unset = UNSET,
) -> CreateIntentResult | ErrorBody | None:
    """Store intent, match merchants (registry or UCP), introduce, notify; returns intentId

    **Key role:** `personal`, `assistant`. An assistant's key works only while its owner-approved link
    (live assist grant) holds.
    Accepts `Idempotency-Key`: the same key with the same body replays the stored response; with a
    different body, 409 `IDEMPOTENCY_CONFLICT`.

    Args:
        idempotency_key (str | Unset):
        body (IntentRequest): POST /personal/intents body (2026-10-17, human direction: search is
            driven by the user's sentence; replaces the fixed trail_shoes / EU 42 / $120 / pinned-
            store demo).  - text   — the user's own words, verbatim. Required. The UCP query when
            `query` is absent; the chat message for             Tier 0 merchants. Never sent in
            introduce callbacks.  - query  — what to search for, when the personal agent extracted it
            (e.g. English keywords for UCP).  - public — conditions the user stated in THIS request;
            sent to introduced merchants. Known keys:      budget   USD, "120" / "$120" / "100-160"
            (upper bound). HARD: offers above it are dropped.      size     e.g. "42", "US 9". SOFT:
            ranks matching variants first; never excludes. A quote whose variant does
            not match carries `sizeNote` ("没有 42，有 41、43"). `shoe_size` is accepted as an alias.
            count    how many different sellers to quote, 1–5 (default 2).      color, deadline, …
            other public conditions, passed through.    Not stated → the card's budget / shoe_size are
            used to RANK only, never to exclude.  - kind   — optional hint, not an enum: registered
            merchants listing it in `capabilities` are introduced too.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateIntentResult | ErrorBody
    """

    return sync_detailed(
        client=client,
        body=body,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: IntentRequest,
    idempotency_key: str | Unset = UNSET,
) -> Response[CreateIntentResult | ErrorBody]:
    """Store intent, match merchants (registry or UCP), introduce, notify; returns intentId

    **Key role:** `personal`, `assistant`. An assistant's key works only while its owner-approved link
    (live assist grant) holds.
    Accepts `Idempotency-Key`: the same key with the same body replays the stored response; with a
    different body, 409 `IDEMPOTENCY_CONFLICT`.

    Args:
        idempotency_key (str | Unset):
        body (IntentRequest): POST /personal/intents body (2026-10-17, human direction: search is
            driven by the user's sentence; replaces the fixed trail_shoes / EU 42 / $120 / pinned-
            store demo).  - text   — the user's own words, verbatim. Required. The UCP query when
            `query` is absent; the chat message for             Tier 0 merchants. Never sent in
            introduce callbacks.  - query  — what to search for, when the personal agent extracted it
            (e.g. English keywords for UCP).  - public — conditions the user stated in THIS request;
            sent to introduced merchants. Known keys:      budget   USD, "120" / "$120" / "100-160"
            (upper bound). HARD: offers above it are dropped.      size     e.g. "42", "US 9". SOFT:
            ranks matching variants first; never excludes. A quote whose variant does
            not match carries `sizeNote` ("没有 42，有 41、43"). `shoe_size` is accepted as an alias.
            count    how many different sellers to quote, 1–5 (default 2).      color, deadline, …
            other public conditions, passed through.    Not stated → the card's budget / shoe_size are
            used to RANK only, never to exclude.  - kind   — optional hint, not an enum: registered
            merchants listing it in `capabilities` are introduced too.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateIntentResult | ErrorBody]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: IntentRequest,
    idempotency_key: str | Unset = UNSET,
) -> CreateIntentResult | ErrorBody | None:
    """Store intent, match merchants (registry or UCP), introduce, notify; returns intentId

    **Key role:** `personal`, `assistant`. An assistant's key works only while its owner-approved link
    (live assist grant) holds.
    Accepts `Idempotency-Key`: the same key with the same body replays the stored response; with a
    different body, 409 `IDEMPOTENCY_CONFLICT`.

    Args:
        idempotency_key (str | Unset):
        body (IntentRequest): POST /personal/intents body (2026-10-17, human direction: search is
            driven by the user's sentence; replaces the fixed trail_shoes / EU 42 / $120 / pinned-
            store demo).  - text   — the user's own words, verbatim. Required. The UCP query when
            `query` is absent; the chat message for             Tier 0 merchants. Never sent in
            introduce callbacks.  - query  — what to search for, when the personal agent extracted it
            (e.g. English keywords for UCP).  - public — conditions the user stated in THIS request;
            sent to introduced merchants. Known keys:      budget   USD, "120" / "$120" / "100-160"
            (upper bound). HARD: offers above it are dropped.      size     e.g. "42", "US 9". SOFT:
            ranks matching variants first; never excludes. A quote whose variant does
            not match carries `sizeNote` ("没有 42，有 41、43"). `shoe_size` is accepted as an alias.
            count    how many different sellers to quote, 1–5 (default 2).      color, deadline, …
            other public conditions, passed through.    Not stated → the card's budget / shoe_size are
            used to RANK only, never to exclude.  - kind   — optional hint, not an enum: registered
            merchants listing it in `capabilities` are introduced too.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateIntentResult | ErrorBody
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            idempotency_key=idempotency_key,
        )
    ).parsed
