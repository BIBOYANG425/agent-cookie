from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.handshake import Handshake
from ...types import UNSET, Response


def _get_kwargs(
    *,
    session_id: str,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["sessionId"] = session_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/agent/handshake",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | Handshake:
    if response.status_code == 200:
        response_200 = Handshake.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = ErrorBody.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ErrorBody.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ErrorBody.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = ErrorBody.from_dict(response.json())

        return response_422

    response_default = ErrorBody.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ErrorBody | Handshake]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    session_id: str,
) -> Response[ErrorBody | Handshake]:
    """?sessionId= → Handshake (field names only)

    **Key role:** `merchant`.

    Args:
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | Handshake]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    session_id: str,
) -> ErrorBody | Handshake | None:
    """?sessionId= → Handshake (field names only)

    **Key role:** `merchant`.

    Args:
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | Handshake
    """

    return sync_detailed(
        client=client,
        session_id=session_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    session_id: str,
) -> Response[ErrorBody | Handshake]:
    """?sessionId= → Handshake (field names only)

    **Key role:** `merchant`.

    Args:
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | Handshake]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    session_id: str,
) -> ErrorBody | Handshake | None:
    """?sessionId= → Handshake (field names only)

    **Key role:** `merchant`.

    Args:
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | Handshake
    """

    return (
        await asyncio_detailed(
            client=client,
            session_id=session_id,
        )
    ).parsed
