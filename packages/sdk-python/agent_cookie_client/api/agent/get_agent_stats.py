from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.merchant_stats import MerchantStats
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/agent/stats",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | MerchantStats:
    if response.status_code == 200:
        response_200 = MerchantStats.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = ErrorBody.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ErrorBody.from_dict(response.json())

        return response_403

    response_default = ErrorBody.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ErrorBody | MerchantStats]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ErrorBody | MerchantStats]:
    """→ MerchantStats: counts over the caller's own sessions only (sessions, returning sessions, quotes,
    accepted, win rate, median ms to quote); never a session id, a field name or value, or anything
    about another merchant (docs/commerce-analytics-plan.md Phase 5)

    **Key role:** `merchant`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | MerchantStats]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> ErrorBody | MerchantStats | None:
    """→ MerchantStats: counts over the caller's own sessions only (sessions, returning sessions, quotes,
    accepted, win rate, median ms to quote); never a session id, a field name or value, or anything
    about another merchant (docs/commerce-analytics-plan.md Phase 5)

    **Key role:** `merchant`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | MerchantStats
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ErrorBody | MerchantStats]:
    """→ MerchantStats: counts over the caller's own sessions only (sessions, returning sessions, quotes,
    accepted, win rate, median ms to quote); never a session id, a field name or value, or anything
    about another merchant (docs/commerce-analytics-plan.md Phase 5)

    **Key role:** `merchant`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | MerchantStats]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> ErrorBody | MerchantStats | None:
    """→ MerchantStats: counts over the caller's own sessions only (sessions, returning sessions, quotes,
    accepted, win rate, median ms to quote); never a session id, a field name or value, or anything
    about another merchant (docs/commerce-analytics-plan.md Phase 5)

    **Key role:** `merchant`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | MerchantStats
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
