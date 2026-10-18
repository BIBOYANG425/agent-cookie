from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.note_view import NoteView
from ...types import UNSET, Response


def _get_kwargs(
    key: str,
    *,
    session_id: str,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["sessionId"] = session_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/agent/notes/{key}".format(
            key=quote(str(key), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | NoteView:
    if response.status_code == 200:
        response_200 = NoteView.from_dict(response.json())

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
) -> Response[ErrorBody | NoteView]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    key: str,
    *,
    client: AuthenticatedClient,
    session_id: str,
) -> Response[ErrorBody | NoteView]:
    """?sessionId= → read own note; anyone else gets 404

    **Key role:** `merchant`.

    Args:
        key (str):
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | NoteView]
    """

    kwargs = _get_kwargs(
        key=key,
        session_id=session_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    key: str,
    *,
    client: AuthenticatedClient,
    session_id: str,
) -> ErrorBody | NoteView | None:
    """?sessionId= → read own note; anyone else gets 404

    **Key role:** `merchant`.

    Args:
        key (str):
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | NoteView
    """

    return sync_detailed(
        key=key,
        client=client,
        session_id=session_id,
    ).parsed


async def asyncio_detailed(
    key: str,
    *,
    client: AuthenticatedClient,
    session_id: str,
) -> Response[ErrorBody | NoteView]:
    """?sessionId= → read own note; anyone else gets 404

    **Key role:** `merchant`.

    Args:
        key (str):
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | NoteView]
    """

    kwargs = _get_kwargs(
        key=key,
        session_id=session_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    key: str,
    *,
    client: AuthenticatedClient,
    session_id: str,
) -> ErrorBody | NoteView | None:
    """?sessionId= → read own note; anyone else gets 404

    **Key role:** `merchant`.

    Args:
        key (str):
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | NoteView
    """

    return (
        await asyncio_detailed(
            key=key,
            client=client,
            session_id=session_id,
        )
    ).parsed
