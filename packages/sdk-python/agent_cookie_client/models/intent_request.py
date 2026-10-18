from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.intent_request_public import IntentRequestPublic


T = TypeVar("T", bound="IntentRequest")


@_attrs_define
class IntentRequest:
    """POST /personal/intents body (2026-10-17, human direction: search is driven by the user's sentence; replaces the
    fixed trail_shoes / EU 42 / $120 / pinned-store demo).  - text   — the user's own words, verbatim. Required. The UCP
    query when `query` is absent; the chat message for             Tier 0 merchants. Never sent in introduce callbacks.
    - query  — what to search for, when the personal agent extracted it (e.g. English keywords for UCP).  - public —
    conditions the user stated in THIS request; sent to introduced merchants. Known keys:      budget   USD, "120" /
    "$120" / "100-160" (upper bound). HARD: offers above it are dropped.      size     e.g. "42", "US 9". SOFT: ranks
    matching variants first; never excludes. A quote whose variant does               not match carries `sizeNote` ("没有
    42，有 41、43"). `shoe_size` is accepted as an alias.      count    how many different sellers to quote, 1–5 (default
    2).      color, deadline, … other public conditions, passed through.    Not stated → the card's budget / shoe_size
    are used to RANK only, never to exclude.  - kind   — optional hint, not an enum: registered merchants listing it in
    `capabilities` are introduced too.

        Attributes:
            text (str):
            query (str | Unset):
            public (IntentRequestPublic | Unset):
            kind (str | Unset):
    """

    text: str
    query: str | Unset = UNSET
    public: IntentRequestPublic | Unset = UNSET
    kind: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        text = self.text

        query = self.query

        public: dict[str, Any] | Unset = UNSET
        if not isinstance(self.public, Unset):
            public = self.public.to_dict()

        kind = self.kind

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "text": text,
            }
        )
        if query is not UNSET:
            field_dict["query"] = query
        if public is not UNSET:
            field_dict["public"] = public
        if kind is not UNSET:
            field_dict["kind"] = kind

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.intent_request_public import IntentRequestPublic

        d = dict(src_dict)
        text = d.pop("text")

        query = d.pop("query", UNSET)

        _public = d.pop("public", UNSET)
        public: IntentRequestPublic | Unset
        if isinstance(_public, Unset):
            public = UNSET
        else:
            public = IntentRequestPublic.from_dict(_public)

        kind = d.pop("kind", UNSET)

        intent_request = cls(
            text=text,
            query=query,
            public=public,
            kind=kind,
        )

        intent_request.additional_properties = d
        return intent_request

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
