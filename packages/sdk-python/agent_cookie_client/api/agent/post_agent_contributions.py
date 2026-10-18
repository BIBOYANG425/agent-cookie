from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.contribution_result import ContributionResult
from ...models.error_body import ErrorBody
from ...models.merchant_contribution_request import MerchantContributionRequest
from ...types import Response


def _get_kwargs(
    *,
    body: MerchantContributionRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/agent/contributions",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ContributionResult | ErrorBody:
    if response.status_code == 201:
        response_201 = ContributionResult.from_dict(response.json())

        return response_201

    if response.status_code == 401:
        response_401 = ErrorBody.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ErrorBody.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ErrorBody.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = ErrorBody.from_dict(response.json())

        return response_422

    response_default = ErrorBody.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ContributionResult | ErrorBody]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: MerchantContributionRequest,
) -> Response[ContributionResult | ErrorBody]:
    """Filtered by canWrite; recomputes card

    **Key role:** `merchant`.

    Args:
        body (MerchantContributionRequest): POST /agent/contributions body. A field outside the
            policy's write section, or a name outside the field table, is kept as the merchant's own
            "inferred" record and never reaches the card (A11), so `field` is any name here.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ContributionResult | ErrorBody]
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
    body: MerchantContributionRequest,
) -> ContributionResult | ErrorBody | None:
    """Filtered by canWrite; recomputes card

    **Key role:** `merchant`.

    Args:
        body (MerchantContributionRequest): POST /agent/contributions body. A field outside the
            policy's write section, or a name outside the field table, is kept as the merchant's own
            "inferred" record and never reaches the card (A11), so `field` is any name here.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ContributionResult | ErrorBody
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: MerchantContributionRequest,
) -> Response[ContributionResult | ErrorBody]:
    """Filtered by canWrite; recomputes card

    **Key role:** `merchant`.

    Args:
        body (MerchantContributionRequest): POST /agent/contributions body. A field outside the
            policy's write section, or a name outside the field table, is kept as the merchant's own
            "inferred" record and never reaches the card (A11), so `field` is any name here.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ContributionResult | ErrorBody]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: MerchantContributionRequest,
) -> ContributionResult | ErrorBody | None:
    """Filtered by canWrite; recomputes card

    **Key role:** `merchant`.

    Args:
        body (MerchantContributionRequest): POST /agent/contributions body. A field outside the
            policy's write section, or a name outside the field table, is kept as the merchant's own
            "inferred" record and never reaches the card (A11), so `field` is any name here.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ContributionResult | ErrorBody
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
