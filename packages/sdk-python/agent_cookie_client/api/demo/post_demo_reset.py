from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.reset_result import ResetResult
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/demo/reset",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | ResetResult:
    if response.status_code == 200:
        response_200 = ResetResult.from_dict(response.json())

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
) -> Response[ErrorBody | ResetResult]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ErrorBody | ResetResult]:
    """Owner key + AGENT_COOKIE_DEMO=1: wipe tables, reseed fixtures, hard-reset the memory repo

    **Key role:** `owner`.
    Mounted only when `AGENT_COOKIE_DEMO=1`; otherwise 404.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | ResetResult]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> ErrorBody | ResetResult | None:
    """Owner key + AGENT_COOKIE_DEMO=1: wipe tables, reseed fixtures, hard-reset the memory repo

    **Key role:** `owner`.
    Mounted only when `AGENT_COOKIE_DEMO=1`; otherwise 404.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | ResetResult
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ErrorBody | ResetResult]:
    """Owner key + AGENT_COOKIE_DEMO=1: wipe tables, reseed fixtures, hard-reset the memory repo

    **Key role:** `owner`.
    Mounted only when `AGENT_COOKIE_DEMO=1`; otherwise 404.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | ResetResult]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> ErrorBody | ResetResult | None:
    """Owner key + AGENT_COOKIE_DEMO=1: wipe tables, reseed fixtures, hard-reset the memory repo

    **Key role:** `owner`.
    Mounted only when `AGENT_COOKIE_DEMO=1`; otherwise 404.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | ResetResult
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
