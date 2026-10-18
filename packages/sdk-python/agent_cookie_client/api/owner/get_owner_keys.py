from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.keys_response import KeysResponse
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/owner/keys",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | KeysResponse:
    if response.status_code == 200:
        response_200 = KeysResponse.from_dict(response.json())

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
) -> Response[ErrorBody | KeysResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ErrorBody | KeysResponse]:
    """→ KeysResponse { keys: KeyView[] } newest first: the keys the owner minted (agentId, role, label,
    createdAt, revokedAt?); never a key or a hash; the owner key, registered agents' keys and Sample
    keys are not listed

    **Key role:** `owner`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | KeysResponse]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> ErrorBody | KeysResponse | None:
    """→ KeysResponse { keys: KeyView[] } newest first: the keys the owner minted (agentId, role, label,
    createdAt, revokedAt?); never a key or a hash; the owner key, registered agents' keys and Sample
    keys are not listed

    **Key role:** `owner`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | KeysResponse
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ErrorBody | KeysResponse]:
    """→ KeysResponse { keys: KeyView[] } newest first: the keys the owner minted (agentId, role, label,
    createdAt, revokedAt?); never a key or a hash; the owner key, registered agents' keys and Sample
    keys are not listed

    **Key role:** `owner`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | KeysResponse]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> ErrorBody | KeysResponse | None:
    """→ KeysResponse { keys: KeyView[] } newest first: the keys the owner minted (agentId, role, label,
    createdAt, revokedAt?); never a key or a hash; the owner key, registered agents' keys and Sample
    keys are not listed

    **Key role:** `owner`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | KeysResponse
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
