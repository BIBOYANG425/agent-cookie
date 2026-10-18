from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.assistant_history_response import AssistantHistoryResponse
from ...models.error_body import ErrorBody
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    limit: int | Unset = 50,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/assistant/history",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> AssistantHistoryResponse | ErrorBody:
    if response.status_code == 200:
        response_200 = AssistantHistoryResponse.from_dict(response.json())

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
) -> Response[AssistantHistoryResponse | ErrorBody]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
) -> Response[AssistantHistoryResponse | ErrorBody]:
    """?limit= (default 50, max 200) → AssistantHistoryResponse { intents }: the person's intent and
    purchase history, newest first, each with its outcome (accepted quote's agentId and status) and its
    public summary; never the user's words (text, query) and never a card field value. Allowed only
    while the installed policy's history.assistant is true, else 403 SCOPE_DENIED; needs the live assist
    grant (SCOPE_DENIED / GRANT_REVOKED / GRANT_EXPIRED as for context). Every allowed read writes a
    receipt (purpose history, fields []), at most one per session per hour; questionsSkipped is
    unchanged by it

    **Key role:** `assistant`.

    Args:
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AssistantHistoryResponse | ErrorBody]
    """

    kwargs = _get_kwargs(
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
) -> AssistantHistoryResponse | ErrorBody | None:
    """?limit= (default 50, max 200) → AssistantHistoryResponse { intents }: the person's intent and
    purchase history, newest first, each with its outcome (accepted quote's agentId and status) and its
    public summary; never the user's words (text, query) and never a card field value. Allowed only
    while the installed policy's history.assistant is true, else 403 SCOPE_DENIED; needs the live assist
    grant (SCOPE_DENIED / GRANT_REVOKED / GRANT_EXPIRED as for context). Every allowed read writes a
    receipt (purpose history, fields []), at most one per session per hour; questionsSkipped is
    unchanged by it

    **Key role:** `assistant`.

    Args:
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AssistantHistoryResponse | ErrorBody
    """

    return sync_detailed(
        client=client,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
) -> Response[AssistantHistoryResponse | ErrorBody]:
    """?limit= (default 50, max 200) → AssistantHistoryResponse { intents }: the person's intent and
    purchase history, newest first, each with its outcome (accepted quote's agentId and status) and its
    public summary; never the user's words (text, query) and never a card field value. Allowed only
    while the installed policy's history.assistant is true, else 403 SCOPE_DENIED; needs the live assist
    grant (SCOPE_DENIED / GRANT_REVOKED / GRANT_EXPIRED as for context). Every allowed read writes a
    receipt (purpose history, fields []), at most one per session per hour; questionsSkipped is
    unchanged by it

    **Key role:** `assistant`.

    Args:
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AssistantHistoryResponse | ErrorBody]
    """

    kwargs = _get_kwargs(
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
) -> AssistantHistoryResponse | ErrorBody | None:
    """?limit= (default 50, max 200) → AssistantHistoryResponse { intents }: the person's intent and
    purchase history, newest first, each with its outcome (accepted quote's agentId and status) and its
    public summary; never the user's words (text, query) and never a card field value. Allowed only
    while the installed policy's history.assistant is true, else 403 SCOPE_DENIED; needs the live assist
    grant (SCOPE_DENIED / GRANT_REVOKED / GRANT_EXPIRED as for context). Every allowed read writes a
    receipt (purpose history, fields []), at most one per session per hour; questionsSkipped is
    unchanged by it

    **Key role:** `assistant`.

    Args:
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AssistantHistoryResponse | ErrorBody
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
        )
    ).parsed
