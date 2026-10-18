from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.clock_request import ClockRequest
from ...models.clock_result import ClockResult
from ...models.error_body import ErrorBody
from ...types import Response


def _get_kwargs(
    *,
    body: ClockRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/test/clock",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ClockResult | ErrorBody:
    if response.status_code == 200:
        response_200 = ClockResult.from_dict(response.json())

        return response_200

    if response.status_code == 422:
        response_422 = ErrorBody.from_dict(response.json())

        return response_422

    response_default = ErrorBody.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ClockResult | ErrorBody]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ClockRequest,
) -> Response[ClockResult | ErrorBody]:
    """{ offsetMs } shifts the server clock; absent otherwise

    **Key:** none.
    Mounted only when `AGENT_COOKIE_TEST=1`; otherwise 404.

    Args:
        body (ClockRequest): POST /test/clock body (AGENT_COOKIE_TEST=1 only).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ClockResult | ErrorBody]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    body: ClockRequest,
) -> ClockResult | ErrorBody | None:
    """{ offsetMs } shifts the server clock; absent otherwise

    **Key:** none.
    Mounted only when `AGENT_COOKIE_TEST=1`; otherwise 404.

    Args:
        body (ClockRequest): POST /test/clock body (AGENT_COOKIE_TEST=1 only).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ClockResult | ErrorBody
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ClockRequest,
) -> Response[ClockResult | ErrorBody]:
    """{ offsetMs } shifts the server clock; absent otherwise

    **Key:** none.
    Mounted only when `AGENT_COOKIE_TEST=1`; otherwise 404.

    Args:
        body (ClockRequest): POST /test/clock body (AGENT_COOKIE_TEST=1 only).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ClockResult | ErrorBody]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: ClockRequest,
) -> ClockResult | ErrorBody | None:
    """{ offsetMs } shifts the server clock; absent otherwise

    **Key:** none.
    Mounted only when `AGENT_COOKIE_TEST=1`; otherwise 404.

    Args:
        body (ClockRequest): POST /test/clock body (AGENT_COOKIE_TEST=1 only).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ClockResult | ErrorBody
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
