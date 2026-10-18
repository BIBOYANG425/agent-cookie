from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.assistant_context import AssistantContext
from ...models.error_body import ErrorBody
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/assistant/context",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> AssistantContext | ErrorBody:
    if response.status_code == 200:
        response_200 = AssistantContext.from_dict(response.json())

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
) -> Response[AssistantContext | ErrorBody]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[AssistantContext | ErrorBody]:
    """→ AssistantContext: auto.assistant values + unknown + writable, no provenance; 403 SCOPE_DENIED
    until a link is approved, GRANT_REVOKED / GRANT_EXPIRED after; writes a receipt (purpose assist,
    field names only), none when the session's last assist receipt named the same fields under the same
    policy less than an hour ago

    **Key role:** `assistant`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AssistantContext | ErrorBody]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> AssistantContext | ErrorBody | None:
    """→ AssistantContext: auto.assistant values + unknown + writable, no provenance; 403 SCOPE_DENIED
    until a link is approved, GRANT_REVOKED / GRANT_EXPIRED after; writes a receipt (purpose assist,
    field names only), none when the session's last assist receipt named the same fields under the same
    policy less than an hour ago

    **Key role:** `assistant`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AssistantContext | ErrorBody
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[AssistantContext | ErrorBody]:
    """→ AssistantContext: auto.assistant values + unknown + writable, no provenance; 403 SCOPE_DENIED
    until a link is approved, GRANT_REVOKED / GRANT_EXPIRED after; writes a receipt (purpose assist,
    field names only), none when the session's last assist receipt named the same fields under the same
    policy less than an hour ago

    **Key role:** `assistant`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AssistantContext | ErrorBody]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> AssistantContext | ErrorBody | None:
    """→ AssistantContext: auto.assistant values + unknown + writable, no provenance; 403 SCOPE_DENIED
    until a link is approved, GRANT_REVOKED / GRANT_EXPIRED after; writes a receipt (purpose assist,
    field names only), none when the session's last assist receipt named the same fields under the same
    policy less than an hour ago

    **Key role:** `assistant`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AssistantContext | ErrorBody
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
