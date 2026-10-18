from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.register_request import RegisterRequest
from ...models.registration import Registration
from ...types import Response


def _get_kwargs(
    *,
    body: RegisterRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/agents/register",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | Registration:
    if response.status_code == 201:
        response_201 = Registration.from_dict(response.json())

        return response_201

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
) -> Response[ErrorBody | Registration]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: RegisterRequest,
) -> Response[ErrorBody | Registration]:
    """Create an agent; returns agentId and a key shown once. Merchants self-register; category personal
    needs the owner key (A13, confirmed); category assistant: like a merchant (no key needed), role
    assistant, callbackUrl and chatEndpoint refused (422)

    **Key:** none, except `category: "personal"`, which needs the owner key.

    Args:
        body (RegisterRequest): POST /agents/register body. A personal agent needs the owner key;
            an assistant takes no callbackUrl or chatEndpoint.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | Registration]
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
    body: RegisterRequest,
) -> ErrorBody | Registration | None:
    """Create an agent; returns agentId and a key shown once. Merchants self-register; category personal
    needs the owner key (A13, confirmed); category assistant: like a merchant (no key needed), role
    assistant, callbackUrl and chatEndpoint refused (422)

    **Key:** none, except `category: "personal"`, which needs the owner key.

    Args:
        body (RegisterRequest): POST /agents/register body. A personal agent needs the owner key;
            an assistant takes no callbackUrl or chatEndpoint.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | Registration
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: RegisterRequest,
) -> Response[ErrorBody | Registration]:
    """Create an agent; returns agentId and a key shown once. Merchants self-register; category personal
    needs the owner key (A13, confirmed); category assistant: like a merchant (no key needed), role
    assistant, callbackUrl and chatEndpoint refused (422)

    **Key:** none, except `category: "personal"`, which needs the owner key.

    Args:
        body (RegisterRequest): POST /agents/register body. A personal agent needs the owner key;
            an assistant takes no callbackUrl or chatEndpoint.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | Registration]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: RegisterRequest,
) -> ErrorBody | Registration | None:
    """Create an agent; returns agentId and a key shown once. Merchants self-register; category personal
    needs the owner key (A13, confirmed); category assistant: like a merchant (no key needed), role
    assistant, callbackUrl and chatEndpoint refused (422)

    **Key:** none, except `category: "personal"`, which needs the owner key.

    Args:
        body (RegisterRequest): POST /agents/register body. A personal agent needs the owner key;
            an assistant takes no callbackUrl or chatEndpoint.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | Registration
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
