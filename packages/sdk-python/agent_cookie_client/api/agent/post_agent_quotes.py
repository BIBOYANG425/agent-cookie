from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.quote import Quote
from ...models.submit_quote_request import SubmitQuoteRequest
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: SubmitQuoteRequest,
    idempotency_key: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(idempotency_key, Unset):
        headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/agent/quotes",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | Quote:
    if response.status_code == 201:
        response_201 = Quote.from_dict(response.json())

        return response_201

    if response.status_code == 401:
        response_401 = ErrorBody.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ErrorBody.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ErrorBody.from_dict(response.json())

        return response_404

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
) -> Response[ErrorBody | Quote]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: SubmitQuoteRequest,
    idempotency_key: str | Unset = UNSET,
) -> Response[ErrorBody | Quote]:
    """Submit a quote for an intent; not introduced → 404, own grant expired/revoked → 403
    GRANT_EXPIRED/GRANT_REVOKED (A13)

    **Key role:** `merchant`.
    Accepts `Idempotency-Key`: the same key with the same body replays the stored response; with a
    different body, 409 `IDEMPOTENCY_CONFLICT`.

    Args:
        idempotency_key (str | Unset):
        body (SubmitQuoteRequest): POST /agent/quotes body.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | Quote]
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
    body: SubmitQuoteRequest,
    idempotency_key: str | Unset = UNSET,
) -> ErrorBody | Quote | None:
    """Submit a quote for an intent; not introduced → 404, own grant expired/revoked → 403
    GRANT_EXPIRED/GRANT_REVOKED (A13)

    **Key role:** `merchant`.
    Accepts `Idempotency-Key`: the same key with the same body replays the stored response; with a
    different body, 409 `IDEMPOTENCY_CONFLICT`.

    Args:
        idempotency_key (str | Unset):
        body (SubmitQuoteRequest): POST /agent/quotes body.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | Quote
    """

    return sync_detailed(
        client=client,
        body=body,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: SubmitQuoteRequest,
    idempotency_key: str | Unset = UNSET,
) -> Response[ErrorBody | Quote]:
    """Submit a quote for an intent; not introduced → 404, own grant expired/revoked → 403
    GRANT_EXPIRED/GRANT_REVOKED (A13)

    **Key role:** `merchant`.
    Accepts `Idempotency-Key`: the same key with the same body replays the stored response; with a
    different body, 409 `IDEMPOTENCY_CONFLICT`.

    Args:
        idempotency_key (str | Unset):
        body (SubmitQuoteRequest): POST /agent/quotes body.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | Quote]
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
    body: SubmitQuoteRequest,
    idempotency_key: str | Unset = UNSET,
) -> ErrorBody | Quote | None:
    """Submit a quote for an intent; not introduced → 404, own grant expired/revoked → 403
    GRANT_EXPIRED/GRANT_REVOKED (A13)

    **Key role:** `merchant`.
    Accepts `Idempotency-Key`: the same key with the same body replays the stored response; with a
    different body, 409 `IDEMPOTENCY_CONFLICT`.

    Args:
        idempotency_key (str | Unset):
        body (SubmitQuoteRequest): POST /agent/quotes body.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | Quote
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            idempotency_key=idempotency_key,
        )
    ).parsed
