from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.mint_key_request import MintKeyRequest
from ...models.mint_key_result import MintKeyResult
from ...types import Response


def _get_kwargs(
    *,
    body: MintKeyRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/owner/keys",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | MintKeyResult:
    if response.status_code == 201:
        response_201 = MintKeyResult.from_dict(response.json())

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
) -> Response[ErrorBody | MintKeyResult]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: MintKeyRequest,
) -> Response[ErrorBody | MintKeyResult]:
    """MintKeyRequest { agentId, role: personal | merchant, label } → 201 MintKeyResult { key, agentId,
    role, label, createdAt }: the key is returned once and never logged or shown again (only its hash is
    stored); an unknown agentId is created (category personal for role personal, retail for merchant,
    name = label), an existing one must have that role (422 MISSING_FIELD); an agent may hold several
    keys

    **Key role:** `owner`.

    Args:
        body (MintKeyRequest): POST /owner/keys body (bring-your-own-agent plan §7, the person's
            own agent): mint a key for one of the person's own agents (`role: "personal"`, category
            personal: it reads the whole card) or for a store's agent the owner adds by hand (`role:
            "merchant"`, category retail). `agentId` is the owner's own name for the agent
            (`[a-z0-9][a-z0-9_.-]{0,63}`, e.g. "laptop"); an unknown one is created with `label` as
            its name, an existing one must already have that role (else 422 MISSING_FIELD). An agent
            may hold several keys; each has its own label and revocation.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | MintKeyResult]
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
    body: MintKeyRequest,
) -> ErrorBody | MintKeyResult | None:
    """MintKeyRequest { agentId, role: personal | merchant, label } → 201 MintKeyResult { key, agentId,
    role, label, createdAt }: the key is returned once and never logged or shown again (only its hash is
    stored); an unknown agentId is created (category personal for role personal, retail for merchant,
    name = label), an existing one must have that role (422 MISSING_FIELD); an agent may hold several
    keys

    **Key role:** `owner`.

    Args:
        body (MintKeyRequest): POST /owner/keys body (bring-your-own-agent plan §7, the person's
            own agent): mint a key for one of the person's own agents (`role: "personal"`, category
            personal: it reads the whole card) or for a store's agent the owner adds by hand (`role:
            "merchant"`, category retail). `agentId` is the owner's own name for the agent
            (`[a-z0-9][a-z0-9_.-]{0,63}`, e.g. "laptop"); an unknown one is created with `label` as
            its name, an existing one must already have that role (else 422 MISSING_FIELD). An agent
            may hold several keys; each has its own label and revocation.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | MintKeyResult
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: MintKeyRequest,
) -> Response[ErrorBody | MintKeyResult]:
    """MintKeyRequest { agentId, role: personal | merchant, label } → 201 MintKeyResult { key, agentId,
    role, label, createdAt }: the key is returned once and never logged or shown again (only its hash is
    stored); an unknown agentId is created (category personal for role personal, retail for merchant,
    name = label), an existing one must have that role (422 MISSING_FIELD); an agent may hold several
    keys

    **Key role:** `owner`.

    Args:
        body (MintKeyRequest): POST /owner/keys body (bring-your-own-agent plan §7, the person's
            own agent): mint a key for one of the person's own agents (`role: "personal"`, category
            personal: it reads the whole card) or for a store's agent the owner adds by hand (`role:
            "merchant"`, category retail). `agentId` is the owner's own name for the agent
            (`[a-z0-9][a-z0-9_.-]{0,63}`, e.g. "laptop"); an unknown one is created with `label` as
            its name, an existing one must already have that role (else 422 MISSING_FIELD). An agent
            may hold several keys; each has its own label and revocation.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | MintKeyResult]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: MintKeyRequest,
) -> ErrorBody | MintKeyResult | None:
    """MintKeyRequest { agentId, role: personal | merchant, label } → 201 MintKeyResult { key, agentId,
    role, label, createdAt }: the key is returned once and never logged or shown again (only its hash is
    stored); an unknown agentId is created (category personal for role personal, retail for merchant,
    name = label), an existing one must have that role (422 MISSING_FIELD); an agent may hold several
    keys

    **Key role:** `owner`.

    Args:
        body (MintKeyRequest): POST /owner/keys body (bring-your-own-agent plan §7, the person's
            own agent): mint a key for one of the person's own agents (`role: "personal"`, category
            personal: it reads the whole card) or for a store's agent the owner adds by hand (`role:
            "merchant"`, category retail). `agentId` is the owner's own name for the agent
            (`[a-z0-9][a-z0-9_.-]{0,63}`, e.g. "laptop"); an unknown one is created with `label` as
            its name, an existing one must already have that role (else 422 MISSING_FIELD). An agent
            may hold several keys; each has its own label and revocation.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | MintKeyResult
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
