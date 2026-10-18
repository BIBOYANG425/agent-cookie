from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...models.error_body import ErrorBody
from ...models.intent_event_type_0 import IntentEventType0
from ...models.intent_event_type_1 import IntentEventType1
from ...models.intent_event_type_2 import IntentEventType2
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: str,
    *,
    last_event_id: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(last_event_id, Unset):
        headers["Last-Event-ID"] = last_event_id

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/personal/intents/{id}/events".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ErrorBody | IntentEventType0 | IntentEventType1 | IntentEventType2:
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> IntentEventType0 | IntentEventType1 | IntentEventType2:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_intent_event_type_0 = IntentEventType0.from_dict(data)

                return componentsschemas_intent_event_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_intent_event_type_1 = IntentEventType1.from_dict(data)

                return componentsschemas_intent_event_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_intent_event_type_2 = IntentEventType2.from_dict(data)

            return componentsschemas_intent_event_type_2

        response_200 = _parse_response_200(response.text)

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
) -> Response[ErrorBody | IntentEventType0 | IntentEventType1 | IntentEventType2]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    last_event_id: str | Unset = UNSET,
) -> Response[ErrorBody | IntentEventType0 | IntentEventType1 | IntentEventType2]:
    """text/event-stream of IntentEvent (events.ts; owner key too): existing quotes first, then each new
    quote as it is inserted (SSE id = the quote's seq; Last-Event-ID resumes after it), `complete` when
    every introduced merchant that can quote has quoted, `expired` when the intent expires; closes after
    complete/expired or INTENT_STREAM_MAX_MS; ':' heartbeat comments every INTENT_STREAM_HEARTBEAT_MS;
    never a field value beyond what GET …/quotes returns; the long-poll stays as the fallback
    (docs/commerce-analytics-plan.md §8)

    **Key role:** `personal`, `assistant`, `owner`. An assistant's key works only while its owner-
    approved link (live assist grant) holds.

    Args:
        id (str):
        last_event_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | IntentEventType0 | IntentEventType1 | IntentEventType2]
    """

    kwargs = _get_kwargs(
        id=id,
        last_event_id=last_event_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    last_event_id: str | Unset = UNSET,
) -> ErrorBody | IntentEventType0 | IntentEventType1 | IntentEventType2 | None:
    """text/event-stream of IntentEvent (events.ts; owner key too): existing quotes first, then each new
    quote as it is inserted (SSE id = the quote's seq; Last-Event-ID resumes after it), `complete` when
    every introduced merchant that can quote has quoted, `expired` when the intent expires; closes after
    complete/expired or INTENT_STREAM_MAX_MS; ':' heartbeat comments every INTENT_STREAM_HEARTBEAT_MS;
    never a field value beyond what GET …/quotes returns; the long-poll stays as the fallback
    (docs/commerce-analytics-plan.md §8)

    **Key role:** `personal`, `assistant`, `owner`. An assistant's key works only while its owner-
    approved link (live assist grant) holds.

    Args:
        id (str):
        last_event_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | IntentEventType0 | IntentEventType1 | IntentEventType2
    """

    return sync_detailed(
        id=id,
        client=client,
        last_event_id=last_event_id,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    last_event_id: str | Unset = UNSET,
) -> Response[ErrorBody | IntentEventType0 | IntentEventType1 | IntentEventType2]:
    """text/event-stream of IntentEvent (events.ts; owner key too): existing quotes first, then each new
    quote as it is inserted (SSE id = the quote's seq; Last-Event-ID resumes after it), `complete` when
    every introduced merchant that can quote has quoted, `expired` when the intent expires; closes after
    complete/expired or INTENT_STREAM_MAX_MS; ':' heartbeat comments every INTENT_STREAM_HEARTBEAT_MS;
    never a field value beyond what GET …/quotes returns; the long-poll stays as the fallback
    (docs/commerce-analytics-plan.md §8)

    **Key role:** `personal`, `assistant`, `owner`. An assistant's key works only while its owner-
    approved link (live assist grant) holds.

    Args:
        id (str):
        last_event_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorBody | IntentEventType0 | IntentEventType1 | IntentEventType2]
    """

    kwargs = _get_kwargs(
        id=id,
        last_event_id=last_event_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    last_event_id: str | Unset = UNSET,
) -> ErrorBody | IntentEventType0 | IntentEventType1 | IntentEventType2 | None:
    """text/event-stream of IntentEvent (events.ts; owner key too): existing quotes first, then each new
    quote as it is inserted (SSE id = the quote's seq; Last-Event-ID resumes after it), `complete` when
    every introduced merchant that can quote has quoted, `expired` when the intent expires; closes after
    complete/expired or INTENT_STREAM_MAX_MS; ':' heartbeat comments every INTENT_STREAM_HEARTBEAT_MS;
    never a field value beyond what GET …/quotes returns; the long-poll stays as the fallback
    (docs/commerce-analytics-plan.md §8)

    **Key role:** `personal`, `assistant`, `owner`. An assistant's key works only while its owner-
    approved link (live assist grant) holds.

    Args:
        id (str):
        last_event_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorBody | IntentEventType0 | IntentEventType1 | IntentEventType2
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            last_event_id=last_event_id,
        )
    ).parsed
