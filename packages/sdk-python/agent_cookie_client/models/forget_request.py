from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ForgetRequest")


@_attrs_define
class ForgetRequest:
    """POST /personal/learned/forget (B49): forget what was learned from one conversation or one intent. Exactly one of the
    two. Every contribution whose evidence names it is revoked in one SQLite transaction and one memory-repo commit
    (with CARD.md); a waiting batch of that conversation is dropped, and a learner answer still in flight for it is
    discarded when it arrives. A later new message in the same conversation is learned from again.

        Attributes:
            conversation_id (str | Unset):
            intent_id (str | Unset):
    """

    conversation_id: str | Unset = UNSET
    intent_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        conversation_id = self.conversation_id

        intent_id = self.intent_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if conversation_id is not UNSET:
            field_dict["conversationId"] = conversation_id
        if intent_id is not UNSET:
            field_dict["intentId"] = intent_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        conversation_id = d.pop("conversationId", UNSET)

        intent_id = d.pop("intentId", UNSET)

        forget_request = cls(
            conversation_id=conversation_id,
            intent_id=intent_id,
        )

        forget_request.additional_properties = d
        return forget_request

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
