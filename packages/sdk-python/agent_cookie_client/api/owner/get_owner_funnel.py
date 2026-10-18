from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.funnel_report import FunnelReport
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    since: str | Unset = UNSET,
    limit: int | Unset = 200,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["since"] = since

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/owner/funnel",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | FunnelReport:
    if response.status_code == 200:
        response_200 = FunnelReport.from_dict(response.json())

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
) -> Response[ErrorBody | FunnelReport]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    since: str | Unset = UNSET,
    limit: int | Unset = 200,
) -> Response[ErrorBody | FunnelReport]:
    """?since=&limit= → FunnelReport: one row per intent, counts only (introduced, quoted, first-quote ms,
    accepted, outcome, fields granted/read, receipts, search filter stats); never field values
    (docs/commerce-analytics-plan.md Phase 0)

    **Key role:** `owner`.

    Args:
        since (str | Unset):
        limit (int | Unset):  Default: 200.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | FunnelReport]
    """

    kwargs = _get_kwargs(
        since=since,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    since: str | Unset = UNSET,
    limit: int | Unset = 200,
) -> ErrorBody | FunnelReport | None:
    """?since=&limit= → FunnelReport: one row per intent, counts only (introduced, quoted, first-quote ms,
    accepted, outcome, fields granted/read, receipts, search filter stats); never field values
    (docs/commerce-analytics-plan.md Phase 0)

    **Key role:** `owner`.

    Args:
        since (str | Unset):
        limit (int | Unset):  Default: 200.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | FunnelReport
    """

    return sync_detailed(
        client=client,
        since=since,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    since: str | Unset = UNSET,
    limit: int | Unset = 200,
) -> Response[ErrorBody | FunnelReport]:
    """?since=&limit= → FunnelReport: one row per intent, counts only (introduced, quoted, first-quote ms,
    accepted, outcome, fields granted/read, receipts, search filter stats); never field values
    (docs/commerce-analytics-plan.md Phase 0)

    **Key role:** `owner`.

    Args:
        since (str | Unset):
        limit (int | Unset):  Default: 200.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | FunnelReport]
    """

    kwargs = _get_kwargs(
        since=since,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    since: str | Unset = UNSET,
    limit: int | Unset = 200,
) -> ErrorBody | FunnelReport | None:
    """?since=&limit= → FunnelReport: one row per intent, counts only (introduced, quoted, first-quote ms,
    accepted, outcome, fields granted/read, receipts, search filter stats); never field values
    (docs/commerce-analytics-plan.md Phase 0)

    **Key role:** `owner`.

    Args:
        since (str | Unset):
        limit (int | Unset):  Default: 200.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | FunnelReport
    """

    return (
        await asyncio_detailed(
            client=client,
            since=since,
            limit=limit,
        )
    ).parsed
