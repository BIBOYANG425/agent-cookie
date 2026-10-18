from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.revoke_key_result import RevokeKeyResult
from ...types import Response


def _get_kwargs(
    agent_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/owner/keys/{agent_id}/revoke".format(
            agent_id=quote(str(agent_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | RevokeKeyResult:
    if response.status_code == 200:
        response_200 = RevokeKeyResult.from_dict(response.json())

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

    response_default = ErrorBody.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ErrorBody | RevokeKeyResult]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[ErrorBody | RevokeKeyResult]:
    """→ RevokeKeyResult { ok, revokedAt, revoked }: revoke every live key of that agent; from then on they
    answer 401 AUTH_REQUIRED; the agent keeps its contributions, sessions and receipts; 404 when the
    owner never minted a key for that agentId

    **Key role:** `owner`.

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | RevokeKeyResult]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> ErrorBody | RevokeKeyResult | None:
    """→ RevokeKeyResult { ok, revokedAt, revoked }: revoke every live key of that agent; from then on they
    answer 401 AUTH_REQUIRED; the agent keeps its contributions, sessions and receipts; 404 when the
    owner never minted a key for that agentId

    **Key role:** `owner`.

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | RevokeKeyResult
    """

    return sync_detailed(
        agent_id=agent_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[ErrorBody | RevokeKeyResult]:
    """→ RevokeKeyResult { ok, revokedAt, revoked }: revoke every live key of that agent; from then on they
    answer 401 AUTH_REQUIRED; the agent keeps its contributions, sessions and receipts; 404 when the
    owner never minted a key for that agentId

    **Key role:** `owner`.

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | RevokeKeyResult]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> ErrorBody | RevokeKeyResult | None:
    """→ RevokeKeyResult { ok, revokedAt, revoked }: revoke every live key of that agent; from then on they
    answer 401 AUTH_REQUIRED; the agent keeps its contributions, sessions and receipts; 404 when the
    owner never minted a key for that agentId

    **Key role:** `owner`.

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | RevokeKeyResult
    """

    return (
        await asyncio_detailed(
            agent_id=agent_id,
            client=client,
        )
    ).parsed
