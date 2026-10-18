from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.unlock_request import UnlockRequest
from ...models.unlock_result import UnlockResult
from ...types import Response


def _get_kwargs(
    *,
    body: UnlockRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/personal/unlock",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | UnlockResult:
    if response.status_code == 200:
        response_200 = UnlockResult.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ErrorBody.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ErrorBody.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = ErrorBody.from_dict(response.json())

        return response_404

    response_default = ErrorBody.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ErrorBody | UnlockResult]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: UnlockRequest,
) -> Response[ErrorBody | UnlockResult]:
    """Lane D P1: passkey assertion unlocks the jar for N minutes. No key: the unlock app's HMAC handoff
    token in the body is the credential

    **Key:** none.
    Lane D (P1): active only when the workspace has both `AGENT_COOKIE_JAR_KEK` and
    `AGENT_COOKIE_UNLOCK_SECRET` set.

    Args:
        body (UnlockRequest): POST /personal/unlock body (lane D): the unlock app's HMAC handoff
            token, issued after a passkey assertion.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | UnlockResult]
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
    body: UnlockRequest,
) -> ErrorBody | UnlockResult | None:
    """Lane D P1: passkey assertion unlocks the jar for N minutes. No key: the unlock app's HMAC handoff
    token in the body is the credential

    **Key:** none.
    Lane D (P1): active only when the workspace has both `AGENT_COOKIE_JAR_KEK` and
    `AGENT_COOKIE_UNLOCK_SECRET` set.

    Args:
        body (UnlockRequest): POST /personal/unlock body (lane D): the unlock app's HMAC handoff
            token, issued after a passkey assertion.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | UnlockResult
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: UnlockRequest,
) -> Response[ErrorBody | UnlockResult]:
    """Lane D P1: passkey assertion unlocks the jar for N minutes. No key: the unlock app's HMAC handoff
    token in the body is the credential

    **Key:** none.
    Lane D (P1): active only when the workspace has both `AGENT_COOKIE_JAR_KEK` and
    `AGENT_COOKIE_UNLOCK_SECRET` set.

    Args:
        body (UnlockRequest): POST /personal/unlock body (lane D): the unlock app's HMAC handoff
            token, issued after a passkey assertion.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | UnlockResult]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: UnlockRequest,
) -> ErrorBody | UnlockResult | None:
    """Lane D P1: passkey assertion unlocks the jar for N minutes. No key: the unlock app's HMAC handoff
    token in the body is the credential

    **Key:** none.
    Lane D (P1): active only when the workspace has both `AGENT_COOKIE_JAR_KEK` and
    `AGENT_COOKIE_UNLOCK_SECRET` set.

    Args:
        body (UnlockRequest): POST /personal/unlock body (lane D): the unlock app's HMAC handoff
            token, issued after a passkey assertion.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | UnlockResult
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
