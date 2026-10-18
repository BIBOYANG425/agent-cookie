from http import HTTPStatus
from typing import Any

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.field import Field
from ...models.fields_response import FieldsResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    session_id: str,
    fields: list[Field],
    purpose: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["sessionId"] = session_id

    json_fields = []
    for fields_item_data in fields:
        fields_item = fields_item_data.value
        json_fields.append(fields_item)

    params["fields"] = json_fields

    params["purpose"] = purpose

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/agent/fields",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | FieldsResponse:
    if response.status_code == 200:
        response_200 = FieldsResponse.from_dict(response.json())

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

    if response.status_code == 422:
        response_422 = ErrorBody.from_dict(response.json())

        return response_422

    response_default = ErrorBody.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ErrorBody | FieldsResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    session_id: str,
    fields: list[Field],
    purpose: str | Unset = UNSET,
) -> Response[ErrorBody | FieldsResponse]:
    """?sessionId=&fields=a,b&purpose= → 200 values | 403 SCOPE_DENIED (incl. names outside the field
    table, A13) | 403 PURPOSE_MISMATCH; purpose releases write a receipt

    **Key role:** `merchant`.

    Args:
        session_id (str):
        fields (list[Field]):
        purpose (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | FieldsResponse]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        fields=fields,
        purpose=purpose,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    session_id: str,
    fields: list[Field],
    purpose: str | Unset = UNSET,
) -> ErrorBody | FieldsResponse | None:
    """?sessionId=&fields=a,b&purpose= → 200 values | 403 SCOPE_DENIED (incl. names outside the field
    table, A13) | 403 PURPOSE_MISMATCH; purpose releases write a receipt

    **Key role:** `merchant`.

    Args:
        session_id (str):
        fields (list[Field]):
        purpose (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | FieldsResponse
    """

    return sync_detailed(
        client=client,
        session_id=session_id,
        fields=fields,
        purpose=purpose,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    session_id: str,
    fields: list[Field],
    purpose: str | Unset = UNSET,
) -> Response[ErrorBody | FieldsResponse]:
    """?sessionId=&fields=a,b&purpose= → 200 values | 403 SCOPE_DENIED (incl. names outside the field
    table, A13) | 403 PURPOSE_MISMATCH; purpose releases write a receipt

    **Key role:** `merchant`.

    Args:
        session_id (str):
        fields (list[Field]):
        purpose (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | FieldsResponse]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        fields=fields,
        purpose=purpose,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    session_id: str,
    fields: list[Field],
    purpose: str | Unset = UNSET,
) -> ErrorBody | FieldsResponse | None:
    """?sessionId=&fields=a,b&purpose= → 200 values | 403 SCOPE_DENIED (incl. names outside the field
    table, A13) | 403 PURPOSE_MISMATCH; purpose releases write a receipt

    **Key role:** `merchant`.

    Args:
        session_id (str):
        fields (list[Field]):
        purpose (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | FieldsResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            session_id=session_id,
            fields=fields,
            purpose=purpose,
        )
    ).parsed
