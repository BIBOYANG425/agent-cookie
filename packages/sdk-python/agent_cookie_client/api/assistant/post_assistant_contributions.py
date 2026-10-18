from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.assistant_contribution_request import AssistantContributionRequest
from ...models.contribution_result import ContributionResult
from ...models.error_body import ErrorBody
from ...types import Response


def _get_kwargs(
    *,
    body: AssistantContributionRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/assistant/contributions",
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
    body: AssistantContributionRequest,
) -> Response[ContributionResult | ErrorBody]:
    """AssistantContributionInput { field, value, basis?, evidence?: { conversationId, snippet } } → 201 {
    stored, contribution } like /agent/contributions, filtered by write.assistant. basis stated REQUIRES
    evidence (both fields; snippet 1–200 characters, the user's own words) else 422 MISSING_FIELD, and
    is stored as stated with its evidence: a single-source card value while the assistant holds a live
    assist grant, a candidate again once the grant is revoked or expires. observed (default) is stored
    as observed and stays a candidate until a second independent source; inferred stays the assistant's
    own record, never on the card; shipping_address and payment_method → 403 SCOPE_DENIED whatever the
    policy says

    **Key role:** `assistant`.

    Args:
        body (AssistantContributionRequest): POST /assistant/contributions body:
            AssistantContributionInput plus the optional session, which must be the assistant's own
            (else 404).

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
    body: AssistantContributionRequest,
) -> ContributionResult | ErrorBody | None:
    """AssistantContributionInput { field, value, basis?, evidence?: { conversationId, snippet } } → 201 {
    stored, contribution } like /agent/contributions, filtered by write.assistant. basis stated REQUIRES
    evidence (both fields; snippet 1–200 characters, the user's own words) else 422 MISSING_FIELD, and
    is stored as stated with its evidence: a single-source card value while the assistant holds a live
    assist grant, a candidate again once the grant is revoked or expires. observed (default) is stored
    as observed and stays a candidate until a second independent source; inferred stays the assistant's
    own record, never on the card; shipping_address and payment_method → 403 SCOPE_DENIED whatever the
    policy says

    **Key role:** `assistant`.

    Args:
        body (AssistantContributionRequest): POST /assistant/contributions body:
            AssistantContributionInput plus the optional session, which must be the assistant's own
            (else 404).

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
    body: AssistantContributionRequest,
) -> Response[ContributionResult | ErrorBody]:
    """AssistantContributionInput { field, value, basis?, evidence?: { conversationId, snippet } } → 201 {
    stored, contribution } like /agent/contributions, filtered by write.assistant. basis stated REQUIRES
    evidence (both fields; snippet 1–200 characters, the user's own words) else 422 MISSING_FIELD, and
    is stored as stated with its evidence: a single-source card value while the assistant holds a live
    assist grant, a candidate again once the grant is revoked or expires. observed (default) is stored
    as observed and stays a candidate until a second independent source; inferred stays the assistant's
    own record, never on the card; shipping_address and payment_method → 403 SCOPE_DENIED whatever the
    policy says

    **Key role:** `assistant`.

    Args:
        body (AssistantContributionRequest): POST /assistant/contributions body:
            AssistantContributionInput plus the optional session, which must be the assistant's own
            (else 404).

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
    body: AssistantContributionRequest,
) -> ContributionResult | ErrorBody | None:
    """AssistantContributionInput { field, value, basis?, evidence?: { conversationId, snippet } } → 201 {
    stored, contribution } like /agent/contributions, filtered by write.assistant. basis stated REQUIRES
    evidence (both fields; snippet 1–200 characters, the user's own words) else 422 MISSING_FIELD, and
    is stored as stated with its evidence: a single-source card value while the assistant holds a live
    assist grant, a candidate again once the grant is revoked or expires. observed (default) is stored
    as observed and stays a candidate until a second independent source; inferred stays the assistant's
    own record, never on the card; shipping_address and payment_method → 403 SCOPE_DENIED whatever the
    policy says

    **Key role:** `assistant`.

    Args:
        body (AssistantContributionRequest): POST /assistant/contributions body:
            AssistantContributionInput plus the optional session, which must be the assistant's own
            (else 404).

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
