from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.observation import Observation
from ...models.observation_ack import ObservationAck
from ...types import Response


def _get_kwargs(
    *,
    body: Observation,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/personal/observations",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | ObservationAck:
    if response.status_code == 202:
        response_202 = ObservationAck.from_dict(response.json())

        return response_202

    if response.status_code == 401:
        response_401 = ErrorBody.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ErrorBody.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = ErrorBody.from_dict(response.json())

        return response_422

    response_default = ErrorBody.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ErrorBody | ObservationAck]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: Observation,
) -> Response[ErrorBody | ObservationAck]:
    """Observation → 202 ObservationAck { queued }: user turns are held in memory per conversation and
    learned from by Dreaming; never blocks; discarded while learning is paused; replayed messageIds
    ignored

    **Key role:** `personal`, `assistant`. An assistant's key works only while its owner-approved link
    (live assist grant) holds.

    Args:
        body (Observation):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | ObservationAck]
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
    body: Observation,
) -> ErrorBody | ObservationAck | None:
    """Observation → 202 ObservationAck { queued }: user turns are held in memory per conversation and
    learned from by Dreaming; never blocks; discarded while learning is paused; replayed messageIds
    ignored

    **Key role:** `personal`, `assistant`. An assistant's key works only while its owner-approved link
    (live assist grant) holds.

    Args:
        body (Observation):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | ObservationAck
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: Observation,
) -> Response[ErrorBody | ObservationAck]:
    """Observation → 202 ObservationAck { queued }: user turns are held in memory per conversation and
    learned from by Dreaming; never blocks; discarded while learning is paused; replayed messageIds
    ignored

    **Key role:** `personal`, `assistant`. An assistant's key works only while its owner-approved link
    (live assist grant) holds.

    Args:
        body (Observation):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | ObservationAck]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: Observation,
) -> ErrorBody | ObservationAck | None:
    """Observation → 202 ObservationAck { queued }: user turns are held in memory per conversation and
    learned from by Dreaming; never blocks; discarded while learning is paused; replayed messageIds
    ignored

    **Key role:** `personal`, `assistant`. An assistant's key works only while its owner-approved link
    (live assist grant) holds.

    Args:
        body (Observation):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | ObservationAck
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
