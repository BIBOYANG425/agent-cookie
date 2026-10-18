from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.learning_state import LearningState
from ...types import Response


def _get_kwargs(
    *,
    body: LearningState,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/personal/learning",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | LearningState:
    if response.status_code == 200:
        response_200 = LearningState.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = ErrorBody.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ErrorBody.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = ErrorBody.from_dict(response.json())

        return response_422

    if response.status_code == 502:
        response_502 = ErrorBody.from_dict(response.json())

        return response_502

    response_default = ErrorBody.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ErrorBody | LearningState]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: LearningState,
) -> Response[ErrorBody | LearningState]:
    """{ paused } → LearningState; pausing also discards conversations waiting in the queue (owner key too)

    **Key role:** `personal`, `owner`.

    Args:
        body (LearningState): GET/PUT /personal/learning. Default `{ paused: false }`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | LearningState]
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
    client: AuthenticatedClient,
    body: LearningState,
) -> ErrorBody | LearningState | None:
    """{ paused } → LearningState; pausing also discards conversations waiting in the queue (owner key too)

    **Key role:** `personal`, `owner`.

    Args:
        body (LearningState): GET/PUT /personal/learning. Default `{ paused: false }`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | LearningState
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: LearningState,
) -> Response[ErrorBody | LearningState]:
    """{ paused } → LearningState; pausing also discards conversations waiting in the queue (owner key too)

    **Key role:** `personal`, `owner`.

    Args:
        body (LearningState): GET/PUT /personal/learning. Default `{ paused: false }`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | LearningState]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: LearningState,
) -> ErrorBody | LearningState | None:
    """{ paused } → LearningState; pausing also discards conversations waiting in the queue (owner key too)

    **Key role:** `personal`, `owner`.

    Args:
        body (LearningState): GET/PUT /personal/learning. Default `{ paused: false }`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | LearningState
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
