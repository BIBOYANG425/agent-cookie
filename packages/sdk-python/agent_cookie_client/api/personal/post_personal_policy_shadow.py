from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.shadow_report import ShadowReport
from ...models.shadow_request import ShadowRequest
from ...types import Response


def _get_kwargs(
    *,
    body: ShadowRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/personal/policy/shadow",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | ShadowReport:
    if response.status_code == 200:
        response_200 = ShadowReport.from_dict(response.json())

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

    response_default = ErrorBody.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ErrorBody | ShadowReport]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: ShadowRequest,
) -> Response[ErrorBody | ShadowReport]:
    """{ policy } → ShadowReport: every past receipt and logged field read re-evaluated under the
    candidate; ids, field names and codes only. Phase 1

    **Key role:** `owner`.

    Args:
        body (ShadowRequest): POST /personal/policy/shadow body.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | ShadowReport]
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
    body: ShadowRequest,
) -> ErrorBody | ShadowReport | None:
    """{ policy } → ShadowReport: every past receipt and logged field read re-evaluated under the
    candidate; ids, field names and codes only. Phase 1

    **Key role:** `owner`.

    Args:
        body (ShadowRequest): POST /personal/policy/shadow body.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | ShadowReport
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: ShadowRequest,
) -> Response[ErrorBody | ShadowReport]:
    """{ policy } → ShadowReport: every past receipt and logged field read re-evaluated under the
    candidate; ids, field names and codes only. Phase 1

    **Key role:** `owner`.

    Args:
        body (ShadowRequest): POST /personal/policy/shadow body.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | ShadowReport]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: ShadowRequest,
) -> ErrorBody | ShadowReport | None:
    """{ policy } → ShadowReport: every past receipt and logged field read re-evaluated under the
    candidate; ids, field names and codes only. Phase 1

    **Key role:** `owner`.

    Args:
        body (ShadowRequest): POST /personal/policy/shadow body.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | ShadowReport
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
