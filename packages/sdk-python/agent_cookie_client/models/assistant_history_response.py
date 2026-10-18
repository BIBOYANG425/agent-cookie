from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.intent_history_entry import IntentHistoryEntry


T = TypeVar("T", bound="AssistantHistoryResponse")


@_attrs_define
class AssistantHistoryResponse:
    """Response of GET /assistant/history, newest first. Entries are the intent history as GET /personal/intents serves it
    MINUS the user's own words: `text` and `query` are never sent to an assistant. Each entry carries id, agentId (who
    created it), kind, public, createdAt, expiresAt and accepted (incl. the merchant's agentId and status). No card
    field values.

        Attributes:
            intents (list[IntentHistoryEntry]):
    """

    intents: list[IntentHistoryEntry]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        intents = []
        for intents_item_data in self.intents:
            intents_item = intents_item_data.to_dict()
            intents.append(intents_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "intents": intents,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.intent_history_entry import IntentHistoryEntry

        d = dict(src_dict)
        intents = []
        _intents = d.pop("intents")
        for intents_item_data in _intents:
            intents_item = IntentHistoryEntry.from_dict(intents_item_data)

            intents.append(intents_item)

        assistant_history_response = cls(
            intents=intents,
        )

        assistant_history_response.additional_properties = d
        return assistant_history_response

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
